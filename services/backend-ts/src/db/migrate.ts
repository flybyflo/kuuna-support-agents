import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getSettings } from "../config.js";

const migrationsTable = "__kuuna_drizzle_migrations";
const migrationNamePattern = /^\d{4}_[a-z0-9][a-z0-9_]*\.sql$/;

function serviceRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return currentDir.endsWith(path.join("dist", "src", "db"))
    ? path.resolve(currentDir, "../../..")
    : path.resolve(currentDir, "../..");
}

function compareMigrationNames(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function logEvent(event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...details }));
}

async function listMigrationNames(migrationsDir: string): Promise<string[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name);

  const invalidNames = migrationNames.filter((name) => !migrationNamePattern.test(name));
  if (invalidNames.length > 0) {
    throw new Error(
      `invalid migration filename(s): ${invalidNames.join(", ")}; expected format 0000_name.sql`,
    );
  }

  return migrationNames.sort(compareMigrationNames);
}

async function main(): Promise<void> {
  const settings = getSettings();
  const client = postgres(settings.DATABASE_URL, { max: 1, prepare: false });
  const db = drizzle(client);

  try {
    await db.execute(drizzleSql.raw(`
      CREATE TABLE IF NOT EXISTS ${migrationsTable} (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `));

    const migrationsDir = path.join(serviceRoot(), "drizzle");
    const migrationNames = await listMigrationNames(migrationsDir);
    let appliedCount = 0;
    let skippedCount = 0;

    for (const name of migrationNames) {
      const applied = await client<{ name: string }[]>`
        SELECT name FROM __kuuna_drizzle_migrations WHERE name = ${name} LIMIT 1
      `;
      if (applied.length > 0) {
        skippedCount += 1;
        logEvent("drizzle_migration_skipped", { name, reason: "already_applied" });
        continue;
      }

      const migrationSql = await readFile(path.join(migrationsDir, name), "utf8");
      const startedAt = Date.now();
      await client.begin(async (transaction) => {
        await transaction.unsafe(migrationSql);
        await transaction`
          INSERT INTO __kuuna_drizzle_migrations (name) VALUES (${name})
        `;
      });
      appliedCount += 1;
      logEvent("drizzle_migration_applied", { name, duration_ms: Date.now() - startedAt });
    }

    logEvent("drizzle_migration_summary", {
      total: migrationNames.length,
      applied: appliedCount,
      skipped: skippedCount,
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event: "drizzle_migration_failed", error: message }));
  process.exitCode = 1;
});

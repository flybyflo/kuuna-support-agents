import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getSettings } from "../config.js";

const migrationsTable = "__kuuna_drizzle_migrations";

function serviceRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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
    const migrationNames = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    for (const name of migrationNames) {
      const applied = await client<{ name: string }[]>`
        SELECT name FROM __kuuna_drizzle_migrations WHERE name = ${name} LIMIT 1
      `;
      if (applied.length > 0) {
        continue;
      }

      const migrationSql = await readFile(path.join(migrationsDir, name), "utf8");
      await db.execute(drizzleSql.raw(migrationSql));
      await client`
        INSERT INTO __kuuna_drizzle_migrations (name) VALUES (${name})
      `;
      console.log(JSON.stringify({ event: "drizzle_migration_applied", name }));
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event: "drizzle_migration_failed", error: message }));
  process.exitCode = 1;
});

import "server-only";

import { Pool, type QueryResultRow } from "pg";

const URL_CANDIDATES = [
  process.env.DATABASE_URL,
  process.env.DASHBOARD_DATABASE_URL,
  "postgresql://postgres:postgres@postgres:5432/kuuna",
  "postgresql://postgres:postgres@localhost:5432/kuuna",
].filter((value): value is string => Boolean(value));

let activePool: Pool | null = null;
let activeUrl: string | null = null;

function normalizeConnectionString(connectionString: string): string {
  return connectionString.replace("postgresql+psycopg://", "postgresql://");
}

async function createWorkingPool(): Promise<Pool> {
  const attempted: string[] = [];

  for (const candidate of URL_CANDIDATES) {
    const normalized = normalizeConnectionString(candidate);
    const pool = new Pool({ connectionString: normalized, max: 8 });

    try {
      await pool.query("select 1");
      activeUrl = normalized;
      return pool;
    } catch (error) {
      attempted.push(normalized);
      await pool.end().catch(() => undefined);
      if (process.env.NODE_ENV !== "production") {
        console.warn("[dashboard-db] connection attempt failed", {
          connectionString: normalized,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  throw new Error(
    `Dashboard database connection failed. Attempted URLs: ${attempted.join(", ")}`,
  );
}

export async function getPool(): Promise<Pool> {
  if (activePool) {
    return activePool;
  }

  activePool = await createWorkingPool();
  return activePool;
}

export async function dbQuery<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const pool = await getPool();
  const result = await pool.query<T>(text, values);
  return result.rows;
}

export function currentDatabaseUrl(): string | null {
  return activeUrl;
}

export function isMissingRelationError(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code;
  return code === "42P01";
}

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getSettings } from "../config.js";
import * as schema from "./schema.js";

const settings = getSettings();

export const sqlClient = postgres(settings.DATABASE_URL, {
  max: 10,
  prepare: false,
});

export const db = drizzle(sqlClient, { schema });

export type Database = typeof db;
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbLike = Database | Transaction;

export async function closeDb(): Promise<void> {
  await sqlClient.end({ timeout: 5 });
}

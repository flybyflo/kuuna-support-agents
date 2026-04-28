import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import { hashPassword, type RoleName } from "../src/auth.js";
import { resetSettingsForTests } from "../src/config.js";
import type { Database } from "../src/db/client.js";
import { appRouter } from "../src/trpc/routers/_app.js";
import { createCallerFactory, createTRPCContext } from "../src/trpc/init.js";
import * as schema from "../src/db/schema.js";

export const contractDatabaseUrl = process.env.BACKEND_TS_CONTRACT_DATABASE_URL;

const createCaller = createCallerFactory(appRouter);

export type ContractDb = Database;
export type AppCaller = ReturnType<typeof createCaller>;

export type EnqueuedJob = {
  name: string;
  data: Record<string, unknown>;
  jobId?: string;
};

export type ContractHarness = {
  db: ContractDb;
  sql: Sql;
  schemaName: string;
  jobs: EnqueuedJob[];
  caller: (token?: string) => Promise<AppCaller>;
  seedUser: (input: {
    email: string;
    password: string;
    role?: RoleName;
    groupScope?: string[];
    isActive?: boolean;
    mustChangePassword?: boolean;
  }) => Promise<{ id: string; email: string }>;
  close: () => Promise<void>;
};

export async function createContractHarness(): Promise<ContractHarness> {
  assert.ok(contractDatabaseUrl, "BACKEND_TS_CONTRACT_DATABASE_URL is required for contract tests");

  process.env.AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || "backend-ts-contract-secret";
  resetSettingsForTests();

  const schemaName = `backend_ts_contract_${randomUUID().replaceAll("-", "_")}`;
  const sql = postgres(contractDatabaseUrl, { max: 1, prepare: false, onnotice: () => undefined });

  await sql.unsafe(`create schema ${schemaName}`);
  await sql.unsafe(`set search_path to ${schemaName}, public`);
  await createContractTables(sql);

  const db = drizzle(sql, { schema }) as Database;
  const jobs: EnqueuedJob[] = [];

  return {
    db,
    sql,
    schemaName,
    jobs,
    caller: async (token?: string) => {
      const headers = new Headers();
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }
      const context = await createTRPCContext({ headers, clientIp: "contract-test", db });
      return createCaller(context);
    },
    seedUser: async (input) => {
      const role = input.role ?? "operator";
      const [user] = await db
        .insert(schema.users)
        .values({
          email: input.email.toLowerCase(),
          passwordHash: hashPassword(input.password),
          mustChangePassword: input.mustChangePassword ?? false,
          isActive: input.isActive ?? true,
        })
        .returning({ id: schema.users.id, email: schema.users.email });
      assert.ok(user);

      const [roleRow] = await db
        .insert(schema.roles)
        .values({ name: role })
        .onConflictDoUpdate({ target: schema.roles.name, set: { name: role } })
        .returning({ id: schema.roles.id });
      assert.ok(roleRow);

      await db.insert(schema.userRoles).values({ userId: user.id, roleId: roleRow.id });
      for (const providerGroupId of Array.from(new Set(input.groupScope ?? [])).sort()) {
        await db.insert(schema.groupAssignments).values({ userId: user.id, providerGroupId });
      }
      return user;
    },
    close: async () => {
      await sql.unsafe(`drop schema if exists ${schemaName} cascade`);
      await sql.end({ timeout: 5 });
    },
  };
}

async function createContractTables(sql: Sql): Promise<void> {
  await sql.unsafe(`
    create extension if not exists pgcrypto;

    create table users (
      id uuid primary key default gen_random_uuid(),
      email text not null unique,
      password_hash text not null,
      must_change_password boolean not null default true,
      is_active boolean not null default true,
      failed_login_attempts integer not null default 0,
      locked_until timestamptz,
      password_changed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table roles (
      id uuid primary key default gen_random_uuid(),
      name text not null unique
    );

    create table user_roles (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      role_id uuid not null references roles(id) on delete cascade,
      unique (user_id, role_id)
    );

    create table group_assignments (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      provider_group_id text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (user_id, provider_group_id)
    );

    create table audit_events (
      id uuid primary key default gen_random_uuid(),
      actor_user_id uuid references users(id) on delete set null,
      event_type text not null,
      entity_type text not null,
      entity_id text not null,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create table group_bindings (
      id uuid primary key default gen_random_uuid(),
      provider_group_id text not null,
      template_version_id uuid not null,
      status text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table messages (
      id uuid primary key default gen_random_uuid(),
      provider_group_id text not null,
      provider_message_id text not null,
      sender_provider_user_id text,
      latest_version_no integer not null default 1,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (provider_group_id, provider_message_id)
    );

    create table message_versions (
      id uuid primary key default gen_random_uuid(),
      message_id uuid not null references messages(id) on delete cascade,
      version_no integer not null,
      event_type text not null,
      is_deleted boolean not null default false,
      text_content text,
      raw_event jsonb not null default '{}'::jsonb,
      occurred_at timestamptz not null,
      created_at timestamptz not null default now(),
      unique (message_id, version_no)
    );

    create table media_assets (
      id uuid primary key default gen_random_uuid(),
      message_id uuid not null references messages(id) on delete cascade,
      provider_media_id text not null,
      mime_type text not null,
      file_name text,
      byte_size integer,
      s3_key text,
      status text not null default 'pending',
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table transcripts (
      id uuid primary key default gen_random_uuid(),
      media_asset_id uuid not null references media_assets(id) on delete cascade,
      text_content text,
      language text,
      status text not null default 'pending',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table message_decisions (
      id uuid primary key default gen_random_uuid(),
      message_id uuid not null references messages(id) on delete cascade,
      provider_group_id text not null,
      decision_type text not null,
      reason text,
      should_execute boolean not null default false,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create table message_links (
      id uuid primary key default gen_random_uuid(),
      message_id uuid not null references messages(id) on delete cascade,
      provider_group_id text not null,
      url text not null,
      normalized_url text not null,
      title text,
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (message_id, normalized_url)
    );

    create table outbound_intents (
      id uuid primary key default gen_random_uuid(),
      outbound_intent_id uuid not null unique,
      provider_group_id text not null,
      status text not null default 'pending',
      attempt_count integer not null default 0,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table retrieval_chunks (
      id uuid primary key default gen_random_uuid(),
      scope text not null,
      provider_group_id text,
      source_type text not null,
      source_id uuid not null,
      chunk_no integer not null,
      content text not null,
      token_count integer not null default 0,
      embedding text,
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (source_type, source_id, chunk_no)
    );
  `);
}

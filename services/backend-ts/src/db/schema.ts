import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const roleName = pgEnum("role_name", ["owner", "admin", "operator", "viewer"]);
export const templateVersionStatus = pgEnum("template_version_status", [
  "draft",
  "ready",
  "published",
  "archived",
]);
export const bindingStatus = pgEnum("binding_status", [
  "draft",
  "provisioning",
  "active",
  "inactive",
  "failed",
]);
export const runtimeMode = pgEnum("runtime_mode", ["on_demand", "hot"]);
export const runtimeStatus = pgEnum("runtime_status", [
  "pending",
  "provisioning",
  "healthy",
  "degraded",
  "stopped",
]);
export const messageEventType = pgEnum("message_event_type", [
  "message_created",
  "message_edited",
  "message_deleted",
]);
export const mediaStatus = pgEnum("media_status", ["pending", "ready", "failed"]);
export const transcriptStatus = pgEnum("transcript_status", ["pending", "ready", "failed"]);
export const knowledgeScope = pgEnum("knowledge_scope", ["common", "group"]);
export const knowledgeVersionStatus = pgEnum("knowledge_version_status", [
  "draft",
  "ready",
  "published",
  "archived",
]);
export const embeddingScope = pgEnum("embedding_scope", ["common", "group"]);
export const outboundStatus = pgEnum("outbound_status", [
  "pending",
  "sending",
  "sent",
  "failed",
]);
export const toolRiskClass = pgEnum("tool_risk_class", ["read", "write", "admin"]);
export const templateBuildStatus = pgEnum("template_build_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const runtimeRunStatus = pgEnum("runtime_run_status", [
  "started",
  "succeeded",
  "failed",
  "timeout",
]);
export const todoStatus = pgEnum("todo_status", ["open", "in_progress", "done", "cancelled"]);
export const todoPriority = pgEnum("todo_priority", ["low", "normal", "high", "urgent"]);
export const agentRunStatus = pgEnum("agent_run_status", ["running", "succeeded", "failed"]);

const createdAt = timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  mustChangePassword: boolean("must_change_password").default(true).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  failedLoginAttempts: integer("failed_login_attempts").default(0).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  createdAt,
  updatedAt,
});

export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: roleName("name").notNull(),
});

export const userRoles = pgTable("user_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  roleId: uuid("role_id").notNull(),
});

export const groupAssignments = pgTable("group_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  providerGroupId: text("provider_group_id").notNull(),
  createdAt,
  updatedAt,
});

export const groupTemplates = pgTable("group_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  displayName: text("display_name").notNull(),
  createdAt,
  updatedAt,
});

export const templateVersions = pgTable("template_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  templateId: uuid("template_id").notNull(),
  versionNo: integer("version_no").notNull(),
  status: templateVersionStatus("status").notNull(),
  systemPrompt: text("system_prompt"),
  modelConfig: jsonb("model_config").default({}).notNull(),
  toolsConfig: jsonb("tools_config").default({}).notNull(),
  egressPolicy: jsonb("egress_policy").default({}).notNull(),
  createdAt,
  updatedAt,
});

export const toolCatalogEntries = pgTable("tool_catalog_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  toolKey: text("tool_key").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description").default("").notNull(),
  riskClass: toolRiskClass("risk_class").notNull(),
  category: text("category").default("general").notNull(),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  createdAt,
  updatedAt,
});

export const groupBindings = pgTable(
  "group_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerGroupId: text("provider_group_id").notNull(),
    templateVersionId: uuid("template_version_id").notNull(),
    status: bindingStatus("status").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => ({
    activeProviderGroupUnique: uniqueIndex("uq_group_bindings_active_provider_group")
      .on(table.providerGroupId)
      .where(sql`status = 'active'`),
  }),
);

export const agentInstances = pgTable(
  "agent_instances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupBindingId: uuid("group_binding_id").notNull(),
    runtimeMode: runtimeMode("runtime_mode").default("on_demand").notNull(),
    status: runtimeStatus("status").notNull(),
    runtimeContainerName: text("runtime_container_name"),
    runtimeBaseUrl: text("runtime_base_url"),
    secretsRef: text("secrets_ref"),
    createdAt,
    updatedAt,
  },
  (table) => ({
    runtimeContainerNameUnique: uniqueIndex("uq_agent_instances_runtime_container_name")
      .on(table.runtimeContainerName)
      .where(sql`runtime_container_name is not null`),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerGroupId: text("provider_group_id").notNull(),
    providerMessageId: text("provider_message_id").notNull(),
    senderProviderUserId: text("sender_provider_user_id"),
    latestVersionNo: integer("latest_version_no").default(1).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => ({
    groupCreatedIdx: index("ix_messages_provider_group_id_created_at").on(
      table.providerGroupId,
      table.createdAt,
    ),
    providerUnique: uniqueIndex("uq_messages_provider_group_message").on(
      table.providerGroupId,
      table.providerMessageId,
    ),
  }),
);

export const messageVersions = pgTable("message_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id").notNull(),
  versionNo: integer("version_no").notNull(),
  eventType: messageEventType("event_type").notNull(),
  isDeleted: boolean("is_deleted").default(false).notNull(),
  textContent: text("text_content"),
  rawEvent: jsonb("raw_event").default({}).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt,
});

export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id").notNull(),
  providerMediaId: text("provider_media_id").notNull(),
  mimeType: text("mime_type").notNull(),
  fileName: text("file_name"),
  byteSize: integer("byte_size"),
  s3Key: text("s3_key"),
  status: mediaStatus("status").default("pending").notNull(),
  metadataJson: jsonb("metadata_json").default({}).notNull(),
  createdAt,
  updatedAt,
});

export const transcripts = pgTable("transcripts", {
  id: uuid("id").defaultRandom().primaryKey(),
  mediaAssetId: uuid("media_asset_id").notNull(),
  textContent: text("text_content"),
  language: text("language"),
  status: transcriptStatus("status").default("pending").notNull(),
  createdAt,
  updatedAt,
});

export const knowledgeCommonDocs = pgTable("knowledge_common_docs", {
  id: uuid("id").defaultRandom().primaryKey(),
  docKey: text("doc_key").notNull(),
  title: text("title").notNull(),
  createdAt,
  updatedAt,
});

export const knowledgeGroupDocs = pgTable("knowledge_group_docs", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerGroupId: text("provider_group_id").notNull(),
  docKey: text("doc_key").notNull(),
  title: text("title").notNull(),
  createdAt,
  updatedAt,
});

export const knowledgeVersions = pgTable("knowledge_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  scope: knowledgeScope("scope").notNull(),
  docRefId: uuid("doc_ref_id").notNull(),
  versionNo: integer("version_no").notNull(),
  status: knowledgeVersionStatus("status").notNull(),
  contentMarkdown: text("content_markdown").notNull(),
  createdAt,
  updatedAt,
});

export const embeddings = pgTable("embeddings", {
  id: uuid("id").defaultRandom().primaryKey(),
  scope: embeddingScope("scope").notNull(),
  sourceVersionId: uuid("source_version_id").notNull(),
  chunkNo: integer("chunk_no").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count").notNull(),
  // pgvector is queried with raw SQL in TS until a typed vector helper is introduced.
  embedding: text("embedding").notNull(),
  createdAt,
  updatedAt,
});

export const outboundIntents = pgTable("outbound_intents", {
  id: uuid("id").defaultRandom().primaryKey(),
  outboundIntentId: uuid("outbound_intent_id").notNull(),
  providerGroupId: text("provider_group_id").notNull(),
  status: outboundStatus("status").default("pending").notNull(),
  attemptCount: integer("attempt_count").default(0).notNull(),
  payload: jsonb("payload").default({}).notNull(),
  createdAt,
  updatedAt,
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: uuid("actor_user_id"),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  payload: jsonb("payload").default({}).notNull(),
  createdAt,
});

export const runtimeRuns = pgTable("runtime_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerGroupId: text("provider_group_id").notNull(),
  messageId: uuid("message_id"),
  bindingId: uuid("binding_id").notNull(),
  templateVersionId: uuid("template_version_id").notNull(),
  templateBuildId: uuid("template_build_id"),
  imageRef: text("image_ref").notNull(),
  status: runtimeRunStatus("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  error: text("error"),
  execution: jsonb("execution").default({}).notNull(),
  createdAt,
  updatedAt,
});

export const templateBuilds = pgTable("template_builds", {
  id: uuid("id").defaultRandom().primaryKey(),
  templateId: uuid("template_id").notNull(),
  templateVersionId: uuid("template_version_id").notNull(),
  status: templateBuildStatus("status").notNull(),
  imageRef: text("image_ref"),
  imageTag: text("image_tag"),
  buildInputs: jsonb("build_inputs").default({}).notNull(),
  logsRef: text("logs_ref"),
  createdAt,
  updatedAt,
});

export const todos = pgTable("todos", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerGroupId: text("provider_group_id").notNull(),
  messageId: uuid("message_id"),
  agentRunId: uuid("agent_run_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: todoStatus("status").default("open").notNull(),
  priority: todoPriority("priority").default("normal").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  exportedAt: timestamp("exported_at", { withTimezone: true }),
  exportAttemptCount: integer("export_attempt_count").default(0).notNull(),
  externalRef: text("external_ref"),
  lastExportError: text("last_export_error"),
  createdAt,
  updatedAt,
});

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id"),
  providerGroupId: text("provider_group_id").notNull(),
  traceId: text("trace_id"),
  status: agentRunStatus("status").notNull(),
  modelPath: jsonb("model_path").default([]).notNull(),
  modelUsed: text("model_used"),
  reasoningEffort: text("reasoning_effort").default("medium").notNull(),
  allowedTools: jsonb("allowed_tools").default([]).notNull(),
  retrievalRefs: jsonb("retrieval_refs").default([]).notNull(),
  responseText: text("response_text"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const messageDecisions = pgTable("message_decisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id").notNull(),
  providerGroupId: text("provider_group_id").notNull(),
  decisionType: text("decision_type").notNull(),
  reason: text("reason"),
  shouldExecute: boolean("should_execute").default(false).notNull(),
  payload: jsonb("payload").default({}).notNull(),
  createdAt,
});

export const toolInvocations = pgTable("tool_invocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentRunId: uuid("agent_run_id"),
  messageId: uuid("message_id"),
  providerGroupId: text("provider_group_id").notNull(),
  toolName: text("tool_name").notNull(),
  ok: boolean("ok").default(false).notNull(),
  stdout: text("stdout").default("").notNull(),
  stderr: text("stderr").default("").notNull(),
  timedOut: boolean("timed_out").default(false).notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  details: jsonb("details").default({}).notNull(),
  createdAt,
});

export const retrievalChunks = pgTable("retrieval_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  scope: text("scope").notNull(),
  providerGroupId: text("provider_group_id"),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  chunkNo: integer("chunk_no").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count").default(0).notNull(),
  embedding: text("embedding"),
  metadataJson: jsonb("metadata_json").default({}).notNull(),
  createdAt,
  updatedAt,
});

export const messageLinks = pgTable("message_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id").notNull(),
  providerGroupId: text("provider_group_id").notNull(),
  url: text("url").notNull(),
  normalizedUrl: text("normalized_url").notNull(),
  title: text("title"),
  metadataJson: jsonb("metadata_json").default({}).notNull(),
  createdAt,
  updatedAt,
});

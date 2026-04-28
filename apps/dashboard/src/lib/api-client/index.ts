import {
  auditEvents,
  bindingTimeline,
  bindings as mockBindings,
  groupAssignments as mockGroupAssignments,
  mediaAssets as mockMediaAssets,
  messages as mockMessages,
  messageVersions as mockMessageVersions,
  promptAssets,
  runtimeDebugStatus,
  templateVersions as mockTemplateVersions,
  templates as mockTemplates,
  toolCatalog,
  traceDetails,
  users as mockUsers,
} from "@/lib/api-client/mock-data";
import type {
  AgentRunRecord,
  AuditEvent,
  BindingTimelineEvent,
  GroupAssignment,
  GroupBinding,
  GroupTemplate,
  KnownProviderGroup,
  KnowledgeDoc,
  MediaAsset,
  MessageDecisionRecord,
  MessageRecord,
  MessageVersion,
  OutboundIntentRecord,
  PromptAsset,
  RuntimeDebugStatus,
  RuntimeRun,
  StaffUser,
  TemplateBuild,
  TemplateBuildStatus,
  TemplateVersion,
  TodoItem,
  ToolCatalogItem,
  ToolInvocationRecord,
  TraceDetail,
  WorkflowStatus,
} from "@/lib/api-client/types";
import { createSessionBackendTrpcClient, getInternalOpsToken } from "@/lib/backend/client";
import { titleFromGroupId } from "@/lib/utils/format";

const ENABLE_MOCK_FALLBACK = process.env.DASHBOARD_ENABLE_MOCK_FALLBACK === "1";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function workflowStatus(value: string): WorkflowStatus {
  const allowed: WorkflowStatus[] = [
    "draft",
    "ready",
    "published",
    "archived",
    "active",
    "inactive",
    "provisioning",
    "failed",
    "queued",
    "processing",
    "running",
    "succeeded",
    "cancelled",
  ];
  return allowed.includes(value as WorkflowStatus) ? (value as WorkflowStatus) : "draft";
}

function templateBuildStatus(value: string): TemplateBuildStatus {
  return value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled"
    ? value
    : "failed";
}

async function withOptionalMock<T>(label: string, loader: () => Promise<T>, fallback: () => T): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (isDynamicServerUsage(error)) {
      throw error;
    }
    console.warn(`[dashboard-api] ${label}: backend failed`, error);
    if (ENABLE_MOCK_FALLBACK) {
      return fallback();
    }
    throw error;
  }
}

function isDynamicServerUsage(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return "digest" in error && (error as { digest?: unknown }).digest === "DYNAMIC_SERVER_USAGE";
}

function mapTemplate(row: {
  id: string;
  key: string;
  display_name: string;
  updated_at: string;
}, versions: TemplateVersion[] = []): GroupTemplate {
  return {
    id: row.id,
    key: row.key,
    displayName: row.display_name,
    description: row.display_name,
    publishedVersionId: versions.find((version) => version.status === "published")?.id ?? "",
    updatedAt: row.updated_at,
  };
}

function mapTemplateVersion(row: {
  id: string;
  template_id: string;
  version_no: number;
  status: string;
  system_prompt?: string | null;
  model_settings?: unknown;
  tools_config?: unknown;
  egress_policy?: unknown;
  updated_at: string;
}): TemplateVersion {
  const model = asRecord(row.model_settings);
  const tools = asRecord(row.tools_config);
  const knowledge = asRecord(tools.knowledge);
  const egress = asRecord(row.egress_policy);
  const modelChain = stringList(model.failover_chain);
  return {
    id: row.id,
    templateId: row.template_id,
    versionNo: row.version_no,
    status: workflowStatus(row.status),
    systemPrompt: row.system_prompt ?? undefined,
    modelChain: modelChain.length ? modelChain : stringList(model.model_path),
    allowedTools: stringList(tools.allowed_tools),
    reasoningEffort:
      model.reasoning_effort === "none" ||
      model.reasoning_effort === "minimal" ||
      model.reasoning_effort === "low" ||
      model.reasoning_effort === "medium" ||
      model.reasoning_effort === "high" ||
      model.reasoning_effort === "xhigh"
        ? model.reasoning_effort
        : "medium",
    toolProfile: stringList(tools.allowed_tools).join(", ") || "default",
    knowledgeProfile: JSON.stringify(knowledge),
    egressPolicy: typeof egress.mode === "string" ? egress.mode : JSON.stringify(egress),
    updatedAt: row.updated_at,
    updatedBy: "backend",
  };
}

function mapBuild(row: {
  id: string;
  template_id: string;
  template_version_id: string;
  status: string;
  image_ref?: string | null;
  image_tag?: string | null;
  build_inputs?: unknown;
  logs_ref?: string | null;
  created_at: string;
  updated_at: string;
}): TemplateBuild {
  return {
    id: row.id,
    templateId: row.template_id,
    templateVersionId: row.template_version_id,
    status: templateBuildStatus(row.status),
    imageRef: row.image_ref ?? undefined,
    imageTag: row.image_tag ?? undefined,
    buildInputs: asRecord(row.build_inputs ?? {}),
    logsRef: row.logs_ref ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBinding(row: {
  id: string;
  provider_group_id: string;
  template_version_id: string;
  status: string;
  updated_at: string;
  agent_instance?: {
    runtime_mode?: string;
    runtime_container_name?: string | null;
    runtime_base_url?: string | null;
    secrets_ref?: string | null;
  } | null;
}): GroupBinding {
  return {
    id: row.id,
    providerGroupId: row.provider_group_id,
    groupTitle: titleFromGroupId(row.provider_group_id),
    templateVersionId: row.template_version_id,
    status: workflowStatus(row.status),
    runtimeMode: row.agent_instance?.runtime_mode === "hot" ? "hot" : "on-demand",
    runtimeContainerName: row.agent_instance?.runtime_container_name ?? undefined,
    runtimeBaseUrl: row.agent_instance?.runtime_base_url ?? undefined,
    secretsRef: row.agent_instance?.secrets_ref ?? undefined,
    updatedAt: row.updated_at,
  };
}

function mapKnowledgeDoc(row: {
  id: string;
  doc_key: string;
  scope: string;
  provider_group_id?: string | null;
  customer_key?: string | null;
  title: string;
  status?: string;
  updated_at?: string;
  updated_by?: string;
  chunk_count?: number;
}): KnowledgeDoc {
  return {
    id: row.id,
    docKey: row.doc_key,
    scope:
      row.scope === "customer"
        ? "customer"
        : row.scope === "group"
          ? "group"
          : "common",
    providerGroupId: row.provider_group_id ?? undefined,
    customerKey: row.customer_key ?? undefined,
    title: row.title,
    status: workflowStatus(row.status ?? "ready"),
    updatedAt: row.updated_at ?? new Date(0).toISOString(),
    updatedBy: row.updated_by ?? "backend",
    chunkCount: row.chunk_count ?? 0,
  };
}

function mediaKind(mimeType: string): MediaAsset["kind"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

function fileExtensionFromMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/plain") return "txt";
  if (mimeType === "audio/mpeg") return "mp3";
  if (mimeType === "audio/ogg") return "ogg";
  if (mimeType === "audio/mp4") return "m4a";
  if (mimeType === "video/mp4") return "mp4";
  return "bin";
}

function mediaFilename(row: { id: string; file_name?: string | null; mime_type: string }): string {
  const fileName = row.file_name?.trim();
  if (fileName) {
    return fileName;
  }
  return `media-${row.id}.${fileExtensionFromMimeType(row.mime_type)}`;
}

function mediaProxyUrl(row: { id: string; message_id: string; updated_at?: string }, disposition?: "inline"): string {
  const params = new URLSearchParams();
  if (row.updated_at) {
    params.set("v", row.updated_at);
  }
  if (disposition) {
    params.set("disposition", disposition);
  }
  const query = params.size ? `?${params.toString()}` : "";
  return `/api/media/${encodeURIComponent(row.message_id)}/${encodeURIComponent(row.id)}/download${query}`;
}

function mapMediaAsset(row: {
  id: string;
  message_id: string;
  mime_type: string;
  file_name?: string | null;
  byte_size?: number | null;
  status: string;
  preview_url?: string | null;
  download_url?: string | null;
  transcript?: string | null;
  updated_at?: string;
}): MediaAsset {
  const kind = mediaKind(row.mime_type);
  const hasDownloadableMedia = Boolean(row.download_url || (kind === "image" && row.preview_url));
  const downloadUrl = hasDownloadableMedia ? mediaProxyUrl(row) : undefined;
  const viewUrl = hasDownloadableMedia ? mediaProxyUrl(row, "inline") : undefined;
  return {
    id: row.id,
    messageId: row.message_id,
    kind,
    filename: mediaFilename(row),
    mimeType: row.mime_type,
    byteSize: row.byte_size ?? undefined,
    status: workflowStatus(row.status),
    transcript: row.transcript ?? undefined,
    viewUrl,
    previewUrl: kind === "image" ? viewUrl : undefined,
    downloadUrl,
  };
}

function mapRuntimeRun(row: {
  id: string;
  provider_group_id: string;
  message_id?: string | null;
  binding_id: string;
  template_version_id: string;
  template_build_id?: string | null;
  image_ref: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  duration_ms?: number | null;
  error?: string | null;
  execution?: unknown;
}): RuntimeRun {
  return {
    id: row.id,
    providerGroupId: row.provider_group_id,
    messageId: row.message_id ?? undefined,
    bindingId: row.binding_id,
    templateVersionId: row.template_version_id,
    templateBuildId: row.template_build_id ?? undefined,
    imageRef: row.image_ref,
    status:
      row.status === "started" || row.status === "succeeded" || row.status === "failed" || row.status === "timeout"
        ? row.status
        : "failed",
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    error: row.error ?? undefined,
    execution: asRecord(row.execution),
  };
}

export async function listTemplates(): Promise<GroupTemplate[]> {
  return withOptionalMock(
    "listTemplates",
    async () => {
      const client = await createSessionBackendTrpcClient();
      const rows = await client.templates.list.query();
      return Promise.all(
        rows.map(async (row) => mapTemplate(row, await listTemplateVersions(row.id))),
      );
    },
    () => mockTemplates,
  );
}

export async function getTemplate(templateId: string): Promise<GroupTemplate | undefined> {
  return withOptionalMock(
    "getTemplate",
    async () => {
      const client = await createSessionBackendTrpcClient();
      return mapTemplate(await client.templates.byId.query({ templateId }), await listTemplateVersions(templateId));
    },
    () => mockTemplates.find((item) => item.id === templateId),
  );
}

export async function listTemplateVersions(templateId: string): Promise<TemplateVersion[]> {
  return withOptionalMock(
    "listTemplateVersions",
    async () => {
      const client = await createSessionBackendTrpcClient();
      return (await client.templates.versions.query({ templateId })).map(mapTemplateVersion);
    },
    () => mockTemplateVersions.filter((item) => item.templateId === templateId),
  );
}

export async function listTemplateBuilds(templateId: string, versionId: string): Promise<TemplateBuild[]> {
  return withOptionalMock(
    "listTemplateBuilds",
    async () => {
      const client = await createSessionBackendTrpcClient();
      return (await client.templates.builds.query({ templateId, versionId })).map(mapBuild);
    },
    () => [],
  );
}

export async function listRuntimeRuns(params: {
  providerGroupId?: string;
  messageId?: string;
  templateVersionId?: string;
  bindingId?: string;
  limit?: number;
}): Promise<RuntimeRun[]> {
  const client = await createSessionBackendTrpcClient();
  const rows = await client.internal.runtimeRuns.query(params);
  return rows.map(mapRuntimeRun);
}

export async function getRuntimeRun(runId: string): Promise<RuntimeRun | undefined> {
  try {
    const client = await createSessionBackendTrpcClient();
    return mapRuntimeRun(await client.internal.runtimeRunById.query({ runId }));
  } catch {
    return undefined;
  }
}

export async function listBindings(): Promise<GroupBinding[]> {
  return withOptionalMock(
    "listBindings",
    async () => {
      const client = await createSessionBackendTrpcClient();
      return (await client.bindings.list.query()).map(mapBinding);
    },
    () => mockBindings,
  );
}

export async function getRuntimeDebugStatus(): Promise<RuntimeDebugStatus> {
  if (!getInternalOpsToken()) {
    return runtimeDebugStatus;
  }
  return withOptionalMock<RuntimeDebugStatus>(
    "getRuntimeDebugStatus",
    async () => {
      const runs = await listRuntimeRuns({ limit: 1 });
      const latest = runs[0];
      return {
        runtimeHealth: latest?.status === "failed" ? "error" : "ok",
        openaiConfigured: null,
        lastModelPath: stringList(latest?.execution.model_path),
        lastModelUsed: typeof latest?.execution.model_used === "string" ? latest.execution.model_used : undefined,
        lastOutboundIntentId:
          typeof latest?.execution.outbound_intent_id === "string" ? latest.execution.outbound_intent_id : undefined,
        lastOutboundAt: latest?.finishedAt ?? latest?.startedAt,
        error: latest?.error,
      };
    },
    () => runtimeDebugStatus,
  );
}

export async function listTodos(providerGroupId?: string): Promise<TodoItem[]> {
  return withOptionalMock(
    "listTodos",
    async () => {
      const client = await createSessionBackendTrpcClient();
      const rows = await client.agentState.todos.query({ providerGroupId, limit: 100 });
      return rows.map((row) => ({
        id: row.id,
        messageId: row.message_id ?? undefined,
        agentRunId: row.agent_run_id ?? undefined,
        providerGroupId: row.provider_group_id,
        groupTitle: titleFromGroupId(row.provider_group_id),
        title: row.title,
        description: row.description ?? undefined,
        status:
          row.status === "open" || row.status === "in_progress" || row.status === "done" || row.status === "cancelled"
            ? row.status
            : "open",
        priority:
          row.priority === "low" || row.priority === "normal" || row.priority === "high" || row.priority === "urgent"
            ? row.priority
            : "normal",
        dueAt: row.due_at ?? undefined,
        completedAt: row.completed_at ?? undefined,
        exportedAt: row.exported_at ?? undefined,
        exportAttemptCount: row.export_attempt_count,
        externalRef: row.external_ref ?? undefined,
        lastExportError: row.last_export_error ?? undefined,
        attachments: (row.attachments ?? []).map(mapMediaAsset),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },
    () => [],
  );
}

export async function listAgentRuns(providerGroupId?: string): Promise<AgentRunRecord[]> {
  return withOptionalMock(
    "listAgentRuns",
    async () => {
      const client = await createSessionBackendTrpcClient();
      return (await client.agentState.agentRuns.query({ providerGroupId, limit: 100 })).map((row) => ({
        id: row.id,
        messageId: row.message_id ?? undefined,
        providerGroupId: row.provider_group_id,
        groupTitle: titleFromGroupId(row.provider_group_id),
        traceId: row.trace_id ?? undefined,
        status: row.status === "running" || row.status === "succeeded" || row.status === "failed" ? row.status : "failed",
        modelPath: stringList(row.model_path),
        modelUsed: row.model_used ?? undefined,
        reasoningEffort: row.reasoning_effort,
        allowedTools: stringList(row.allowed_tools),
        retrievalRefs: stringList(row.retrieval_refs),
        responseText: row.response_text ?? undefined,
        responsePreview: row.response_text?.slice(0, 220),
        error: row.error ?? undefined,
        startedAt: row.started_at,
        completedAt: row.completed_at ?? undefined,
      }));
    },
    () => [],
  );
}

export async function listOutboundIntents(
  providerGroupId?: string,
): Promise<OutboundIntentRecord[]> {
  return withOptionalMock(
    "listOutboundIntents",
    async () => {
      const client = await createSessionBackendTrpcClient();
      const rows = await client.agentState.outboundIntents.query({
        providerGroupId,
        limit: 100,
      });
      return rows.map((row) => ({
        id: row.id,
        outboundIntentId: row.outbound_intent_id,
        providerGroupId: row.provider_group_id,
        status:
          row.status === "pending" ||
          row.status === "sending" ||
          row.status === "sent" ||
          row.status === "failed"
            ? row.status
            : "pending",
        attemptCount: row.attempt_count,
        text: row.text ?? "",
        replyToProviderMessageId: row.reply_to_provider_message_id ?? undefined,
        agentRunId: row.agent_run_id ?? undefined,
        agentInstanceId: row.agent_instance_id ?? undefined,
        lastError: row.last_error ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },
    () => [],
  );
}

export async function listMessageDecisions(providerGroupId?: string): Promise<MessageDecisionRecord[]> {
  return withOptionalMock(
    "listMessageDecisions",
    async () => {
      const client = await createSessionBackendTrpcClient();
      return (await client.agentState.messageDecisions.query({ providerGroupId, limit: 100 })).map((row) => ({
        id: row.id,
        messageId: row.message_id,
        providerGroupId: row.provider_group_id,
        groupTitle: titleFromGroupId(row.provider_group_id),
        decisionType: row.decision_type,
        reason: row.reason ?? undefined,
        shouldExecute: row.should_execute,
        payloadSummary: JSON.stringify(row.payload ?? {}).slice(0, 180),
        createdAt: row.created_at,
      }));
    },
    () => [],
  );
}

export async function listToolInvocations(
  providerGroupId?: string,
  agentRunId?: string,
): Promise<ToolInvocationRecord[]> {
  return withOptionalMock(
    "listToolInvocations",
    async () => {
      const client = await createSessionBackendTrpcClient();
      return (await client.agentState.toolInvocations.query({ providerGroupId, limit: 100 }))
        .filter((row) => !agentRunId || row.agent_run_id === agentRunId)
        .map((row) => ({
          id: row.id,
          agentRunId: row.agent_run_id ?? undefined,
          messageId: row.message_id ?? undefined,
          providerGroupId: row.provider_group_id,
          groupTitle: titleFromGroupId(row.provider_group_id),
          toolName: row.tool_name,
          ok: row.ok,
          stdout: row.stdout || undefined,
          stdoutPreview: row.stdout?.slice(0, 160) || undefined,
          stderr: row.stderr || undefined,
          stderrPreview: row.stderr?.slice(0, 160) || undefined,
          timedOut: row.timed_out,
          durationMs: row.duration_ms,
          detailsSummary: JSON.stringify(row.details ?? {}).slice(0, 180),
          createdAt: row.created_at,
        }));
    },
    () => [],
  );
}

export async function listTools(): Promise<ToolCatalogItem[]> {
  return withOptionalMock(
    "listTools",
    async () => {
      const client = await createSessionBackendTrpcClient();
      return (await client.tools.list.query()).map((row) => ({
        id: row.id,
        toolKey: row.tool_key,
        displayName: row.display_name,
        description: row.description,
        riskClass: row.risk_class,
        category: row.category,
        isEnabled: row.is_enabled,
        updatedAt: row.updated_at,
      }));
    },
    () => toolCatalog,
  );
}

export async function getBinding(bindingId: string): Promise<GroupBinding | undefined> {
  return withOptionalMock(
    "getBinding",
    async () => {
      const client = await createSessionBackendTrpcClient();
      const row = await client.bindings.byId.query(bindingId);
      return row ? mapBinding(row) : undefined;
    },
    () => mockBindings.find((item) => item.id === bindingId),
  );
}

export async function listBindingTimeline(bindingId: string): Promise<BindingTimelineEvent[]> {
  const binding = await getBinding(bindingId);
  if (!binding) {
    return ENABLE_MOCK_FALLBACK ? bindingTimeline.filter((item) => item.bindingId === bindingId) : [];
  }
  return [
    {
      id: `${binding.id}:current`,
      bindingId: binding.id,
      status: binding.status,
      label: `Binding ${binding.status}`,
      occurredAt: binding.updatedAt,
    },
  ];
}

export async function listKnownProviderGroups(): Promise<KnownProviderGroup[]> {
  const groups = new Map<string, KnownProviderGroup>();
  for (const binding of await listBindings()) {
    groups.set(binding.providerGroupId, {
      providerGroupId: binding.providerGroupId,
      groupTitle: binding.groupTitle,
      lastSeenAt: binding.updatedAt,
      sources: ["binding"],
    });
  }
  for (const message of await listMessages()) {
    const current = groups.get(message.providerGroupId);
    if (current) {
      if (!current.sources.includes("message")) current.sources.push("message");
      if (!current.lastSeenAt || current.lastSeenAt < message.createdAt) current.lastSeenAt = message.createdAt;
    } else {
      groups.set(message.providerGroupId, {
        providerGroupId: message.providerGroupId,
        groupTitle: titleFromGroupId(message.providerGroupId),
        lastSeenAt: message.createdAt,
        sources: ["message"],
      });
    }
  }
  return Array.from(groups.values());
}

export async function listPromptAssets(instanceId?: string): Promise<PromptAsset[]> {
  if (ENABLE_MOCK_FALLBACK) {
    return promptAssets.filter((item) => !instanceId || item.instanceId === instanceId);
  }
  return [];
}

export async function listKnowledgeDocs(
  scope?: "common" | "group" | "customer",
  providerGroupId?: string,
): Promise<KnowledgeDoc[]> {
  return withOptionalMock(
    "listKnowledgeDocs",
    async () => {
      const client = await createSessionBackendTrpcClient();
      if (scope === "common") {
        return (await client.knowledge.ingestedCommonDocs.query()).map(mapKnowledgeDoc);
      }
      if (scope === "group") {
        return (await client.knowledge.ingestedGroupDocs.query({ providerGroupId })).map(mapKnowledgeDoc);
      }
      if (scope === "customer" && providerGroupId) {
        return (await client.knowledge.customerDocs.query({ providerGroupId })).map(mapKnowledgeDoc);
      }
      const [commonDocs, groupDocs, customerDocs] = await Promise.all([
        client.knowledge.ingestedCommonDocs.query(),
        client.knowledge.ingestedGroupDocs.query({ providerGroupId }),
        providerGroupId
          ? client.knowledge.customerDocs.query({ providerGroupId })
          : Promise.resolve([]),
      ]);
      return [...commonDocs, ...groupDocs, ...customerDocs].map(mapKnowledgeDoc);
    },
    () => [],
  );
}

export async function listMessages(providerGroupId?: string): Promise<MessageRecord[]> {
  return withOptionalMock(
    "listMessages",
    async () => {
      const client = await createSessionBackendTrpcClient();
      const rows = await client.messages.list.query({ providerGroupId, limit: 100 });
      return rows.map((row) => {
        const raw = asRecord(row.latest_raw_event);
        return {
          id: row.id,
          providerGroupId: row.provider_group_id,
          sender: row.sender_provider_user_id ?? "unknown",
          senderPhone: typeof raw.sender_phone === "string" ? raw.sender_phone : undefined,
          senderPushName: typeof raw.sender_push_name === "string" ? raw.sender_push_name : undefined,
          preview: row.latest_text ?? "",
          hasMedia: row.has_media,
          isDeleted: row.latest_is_deleted,
          latestVersionNo: row.latest_version_no,
          createdAt: row.created_at,
        };
      });
    },
    () => mockMessages.filter((item) => !providerGroupId || item.providerGroupId === providerGroupId),
  );
}

export async function listMessageVersions(messageId: string): Promise<MessageVersion[]> {
  return withOptionalMock(
    "listMessageVersions",
    async () => {
      const client = await createSessionBackendTrpcClient();
      return (await client.messages.versions.query({ messageId })).map((row) => {
        const eventType =
          row.event_type === "message_deleted"
            ? "deleted"
            : row.event_type === "message_edited"
              ? "edited"
              : "created";
        return {
          id: row.id,
          messageId: row.message_id,
          versionNo: row.version_no,
          eventType,
          text: row.text ?? "",
          occurredAt: row.occurred_at,
        };
      });
    },
    () => mockMessageVersions.filter((item) => item.messageId === messageId),
  );
}

export async function listMediaAssets(messageId: string): Promise<MediaAsset[]> {
  return withOptionalMock(
    "listMediaAssets",
    async () => {
      const client = await createSessionBackendTrpcClient();
      return (await client.messages.media.query({ messageId })).map(mapMediaAsset);
    },
    () => mockMediaAssets.filter((item) => item.messageId === messageId),
  );
}

export async function listAuditEvents(): Promise<AuditEvent[]> {
  return withOptionalMock(
    "listAuditEvents",
    async () => {
      const client = await createSessionBackendTrpcClient();
      return (await client.audit.events.query({ limit: 100 })).map((row) => {
        const payload = asRecord(row.payload);
        const traceId =
          typeof payload.trace_id === "string"
            ? payload.trace_id
            : typeof payload.traceId === "string"
              ? payload.traceId
              : "";
        return {
          id: row.id,
          eventType: row.event_type,
          actor: row.actor_user_id ?? "system",
          entityType: row.entity_type,
          entityId: row.entity_id,
          traceId,
          createdAt: row.created_at,
          metadata: JSON.stringify(row.payload ?? {}),
        };
      });
    },
    () => auditEvents,
  );
}

export async function getTraceDetail(traceId: string): Promise<TraceDetail | undefined> {
  const mock = traceDetails.find((item) => item.traceId === traceId);
  const event = (await listAuditEvents()).find((item) => item.traceId === traceId);
  if (!event) {
    return ENABLE_MOCK_FALLBACK ? mock : undefined;
  }
  return {
    traceId,
    providerGroupId: "",
    inboundEventId: event.entityId,
    retrievalRefs: [],
    modelPath: [],
    outboundIntentId: "",
  };
}

export async function listUsers(): Promise<StaffUser[]> {
  return withOptionalMock(
    "listUsers",
    async () => {
      const client = await createSessionBackendTrpcClient();
      return (await client.users.list.query()).map((row) => {
        const role = pickHighestRole(row.roles);
        return {
          id: row.id,
          email: row.email,
          displayName: row.email,
          role,
          active: row.is_active,
        };
      });
    },
    () => mockUsers,
  );
}

export async function listGroupAssignments(): Promise<GroupAssignment[]> {
  return withOptionalMock(
    "listGroupAssignments",
    async () => {
      const client = await createSessionBackendTrpcClient();
      return (await client.users.assignments.query()).map((row) => ({
        id: row.id,
        userId: row.user_id,
        user: row.user_email,
        providerGroupId: row.provider_group_id,
        groupTitle: titleFromGroupId(row.provider_group_id),
      }));
    },
    () => mockGroupAssignments,
  );
}

function pickHighestRole(roles: string[]): StaffUser["role"] {
  if (roles.includes("owner")) return "owner";
  if (roles.includes("admin")) return "admin";
  if (roles.includes("operator")) return "operator";
  return "viewer";
}

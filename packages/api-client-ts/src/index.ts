export type WorkflowStatus =
  | "draft"
  | "ready"
  | "published"
  | "archived"
  | "active"
  | "inactive"
  | "provisioning"
  | "failed"
  | "queued"
  | "processing"
  | "running"
  | "succeeded"
  | "cancelled";

export type TemplateBuildStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type GroupTemplate = {
  id: string;
  key: string;
  displayName: string;
  description: string;
  publishedVersionId: string;
  updatedAt: string;
};

export type TemplateVersion = {
  id: string;
  templateId: string;
  versionNo: number;
  status: WorkflowStatus;
  systemPrompt?: string;
  modelChain: string[];
  allowedTools?: string[];
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  toolProfile: string;
  knowledgeProfile: string;
  egressPolicy: string;
  updatedAt: string;
  updatedBy: string;
};

export type TemplateBuild = {
  id: string;
  templateId: string;
  templateVersionId: string;
  status: TemplateBuildStatus;
  imageRef?: string;
  imageTag?: string;
  buildInputs: Record<string, unknown>;
  logsRef?: string;
  createdAt: string;
  updatedAt: string;
};

export type GroupBinding = {
  id: string;
  providerGroupId: string;
  groupTitle: string;
  templateVersionId: string;
  status: WorkflowStatus;
  runtimeMode: "on-demand" | "hot";
  runtimeContainerName?: string;
  runtimeBaseUrl?: string;
  secretsRef?: string;
  updatedAt: string;
};

export type ToolCatalogItem = {
  id: string;
  toolKey: string;
  displayName: string;
  description: string;
  riskClass: "read" | "write" | "admin";
  category: string;
  isEnabled: boolean;
  updatedAt: string;
};

export type KnownProviderGroup = {
  providerGroupId: string;
  groupTitle: string;
  lastSeenAt?: string;
  sources: Array<"binding" | "message" | "assignment" | "knowledge">;
};

export type BindingTimelineEvent = {
  id: string;
  bindingId: string;
  status: WorkflowStatus;
  label: string;
  occurredAt: string;
  details?: string;
};

export type PromptAsset = {
  id: string;
  templateId: string;
  templateName: string;
  templateVersionId: string;
  instanceId: string;
  instanceName: string;
  type: "system" | "user";
  title: string;
  status: WorkflowStatus;
  versionNo: number;
  updatedAt: string;
  updatedBy: string;
};

export type RuntimeRunStatus = "started" | "succeeded" | "failed" | "timeout";

export type RuntimeRun = {
  id: string;
  providerGroupId: string;
  messageId?: string;
  bindingId: string;
  templateVersionId: string;
  templateBuildId?: string;
  imageRef: string;
  status: RuntimeRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
  execution: Record<string, unknown>;
};

export type KnowledgeDoc = {
  id: string;
  docKey: string;
  scope: "common" | "group";
  providerGroupId?: string;
  title: string;
  status: WorkflowStatus;
  updatedAt: string;
  updatedBy: string;
  chunkCount: number;
};

export type KnowledgeDocVersion = {
  id: string;
  scope: "common" | "group";
  docRefId: string;
  versionNo: number;
  status: WorkflowStatus;
  contentMarkdown: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type MessageRecord = {
  id: string;
  providerGroupId: string;
  sender: string;
  senderPhone?: string;
  senderPushName?: string;
  preview: string;
  hasMedia: boolean;
  isDeleted: boolean;
  latestVersionNo: number;
  createdAt: string;
};

export type MessageVersion = {
  id: string;
  messageId: string;
  versionNo: number;
  eventType: "created" | "edited" | "deleted";
  text: string;
  occurredAt: string;
};

export type MediaAsset = {
  id: string;
  messageId: string;
  kind: "image" | "audio" | "video" | "file";
  filename: string;
  status: WorkflowStatus;
  transcript?: string;
  previewUrl?: string;
};

export type AuditEvent = {
  id: string;
  eventType: string;
  actor: string;
  entityType: string;
  entityId: string;
  traceId: string;
  createdAt: string;
  metadata: string;
};

export type TraceDetail = {
  traceId: string;
  providerGroupId: string;
  inboundEventId: string;
  retrievalRefs: string[];
  modelPath: string[];
  outboundIntentId: string;
};

export type StaffUser = {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "admin" | "operator" | "viewer";
  active: boolean;
};

export type GroupAssignment = {
  id: string;
  userId: string;
  user: string;
  providerGroupId: string;
  groupTitle: string;
};

export type RuntimeDebugStatus = {
  runtimeHealth: "ok" | "unreachable" | "error";
  runtimeUrl?: string;
  openaiConfigured: boolean | null;
  openaiBaseUrl?: string;
  openaiTimeoutSeconds?: string;
  defaultModel?: string;
  reasoningEffort?: string;
  lastModelPath: string[];
  lastModelUsed?: string;
  lastOutboundIntentId?: string;
  lastOutboundAt?: string;
  error?: string;
};

export type TodoItem = {
  id: string;
  providerGroupId: string;
  groupTitle: string;
  title: string;
  description?: string;
  status: "open" | "in_progress" | "done" | "cancelled";
  priority: "low" | "normal" | "high" | "urgent";
  dueAt?: string;
  exportedAt?: string;
  exportAttemptCount: number;
  externalRef?: string;
  lastExportError?: string;
  updatedAt: string;
};

export type AgentRunRecord = {
  id: string;
  messageId?: string;
  providerGroupId: string;
  groupTitle: string;
  traceId?: string;
  status: "running" | "succeeded" | "failed";
  modelPath: string[];
  modelUsed?: string;
  reasoningEffort: string;
  allowedTools: string[];
  retrievalRefs: string[];
  responseText?: string;
  responsePreview?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
};

export type MessageDecisionRecord = {
  id: string;
  messageId: string;
  providerGroupId: string;
  groupTitle: string;
  decisionType: string;
  reason?: string;
  shouldExecute: boolean;
  payloadSummary: string;
  createdAt: string;
};

export type ToolInvocationRecord = {
  id: string;
  agentRunId?: string;
  messageId?: string;
  providerGroupId: string;
  groupTitle: string;
  toolName: string;
  ok: boolean;
  stdout?: string;
  stdoutPreview?: string;
  stderr?: string;
  stderrPreview?: string;
  timedOut: boolean;
  durationMs: number;
  detailsSummary: string;
  createdAt: string;
};

export type BackendTodoRead = {
  id: string;
  provider_group_id: string;
  message_id?: string | null;
  agent_run_id?: string | null;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  due_at?: string | null;
  completed_at?: string | null;
  exported_at?: string | null;
  export_attempt_count: number;
  external_ref?: string | null;
  last_export_error?: string | null;
  created_at: string;
  updated_at: string;
};

export type BackendAgentRunRead = {
  id: string;
  message_id?: string | null;
  provider_group_id: string;
  trace_id?: string | null;
  status: string;
  model_path: unknown[];
  model_used?: string | null;
  reasoning_effort: string;
  allowed_tools: unknown[];
  retrieval_refs: unknown[];
  response_text?: string | null;
  error?: string | null;
  started_at: string;
  completed_at?: string | null;
};

export type BackendMessageDecisionRead = {
  id: string;
  message_id: string;
  provider_group_id: string;
  decision_type: string;
  reason?: string | null;
  should_execute: boolean;
  payload: unknown;
  created_at: string;
};

export type BackendToolInvocationRead = {
  id: string;
  agent_run_id?: string | null;
  message_id?: string | null;
  provider_group_id: string;
  tool_name: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  duration_ms: number;
  details: unknown;
  created_at: string;
};

export type BackendListParams = {
  providerGroupId?: string;
};

export type BackendToolInvocationListParams = BackendListParams & {
  agentRunId?: string;
};

export type BackendMessageDecisionListParams = BackendListParams & {
  messageId?: string;
};

type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  cache?: string;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
};

export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>;

export type KuunaApiClientOptions = {
  baseUrl: string;
  fetchImpl?: FetchLike;
  groupTitleForProviderGroupId?: (providerGroupId: string) => string;
};

export class KuunaApiClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "KuunaApiClientError";
  }
}

type UnknownRecord = Record<string, unknown>;

function defaultFetch(): FetchLike {
  const maybeFetch = (globalThis as typeof globalThis & { fetch?: FetchLike }).fetch;
  if (!maybeFetch) {
    throw new KuunaApiClientError("No fetch implementation is available");
  }
  return maybeFetch;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function readString(record: UnknownRecord, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new KuunaApiClientError(`${path}.${key} must be a string`);
  }
  return value;
}

function readOptionalString(record: UnknownRecord, key: string, path: string): string | undefined {
  const value = record[key];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new KuunaApiClientError(`${path}.${key} must be a string or null`);
  }
  return value;
}

function readBoolean(record: UnknownRecord, key: string, path: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new KuunaApiClientError(`${path}.${key} must be a boolean`);
  }
  return value;
}

function readNumber(record: UnknownRecord, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new KuunaApiClientError(`${path}.${key} must be a number`);
  }
  return value;
}

function readArray(record: UnknownRecord, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function assertArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new KuunaApiClientError(`${path} must be an array`);
  }
  return value;
}

function compactStringList(value: unknown[]): string[] {
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function summarizeJson(value: unknown, maxLength = 180): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) {
    return "";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function toTodoStatus(value: string): TodoItem["status"] {
  if (value === "open" || value === "in_progress" || value === "done" || value === "cancelled") {
    return value;
  }
  return "open";
}

function toTodoPriority(value: string): TodoItem["priority"] {
  if (value === "low" || value === "normal" || value === "high" || value === "urgent") {
    return value;
  }
  return "normal";
}

function toAgentRunStatus(value: string): AgentRunRecord["status"] {
  if (value === "running" || value === "succeeded" || value === "failed") {
    return value;
  }
  return "failed";
}

function titleFromProviderGroupId(providerGroupId: string): string {
  if (providerGroupId.includes("@")) {
    const [user, server] = providerGroupId.split("@", 2);
    if (server === "g.us") {
      return `WhatsApp Group ${user}`;
    }
    if (server === "lid") {
      return `WhatsApp Chat ${user}`;
    }
    if (server === "s.whatsapp.net") {
      return `WhatsApp Contact ${user}`;
    }
    return `WhatsApp ${providerGroupId}`;
  }

  return providerGroupId
    .replace(/^grp-/, "")
    .split("-")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function toBackendTodoRead(value: unknown, path: string): BackendTodoRead {
  if (!isRecord(value)) {
    throw new KuunaApiClientError(`${path} must be an object`);
  }
  return {
    id: readString(value, "id", path),
    provider_group_id: readString(value, "provider_group_id", path),
    message_id: readOptionalString(value, "message_id", path),
    agent_run_id: readOptionalString(value, "agent_run_id", path),
    title: readString(value, "title", path),
    description: readOptionalString(value, "description", path),
    status: readString(value, "status", path),
    priority: readString(value, "priority", path),
    due_at: readOptionalString(value, "due_at", path),
    completed_at: readOptionalString(value, "completed_at", path),
    exported_at: readOptionalString(value, "exported_at", path),
    export_attempt_count: readNumber(value, "export_attempt_count", path),
    external_ref: readOptionalString(value, "external_ref", path),
    last_export_error: readOptionalString(value, "last_export_error", path),
    created_at: readString(value, "created_at", path),
    updated_at: readString(value, "updated_at", path),
  };
}

function toBackendAgentRunRead(value: unknown, path: string): BackendAgentRunRead {
  if (!isRecord(value)) {
    throw new KuunaApiClientError(`${path} must be an object`);
  }
  return {
    id: readString(value, "id", path),
    message_id: readOptionalString(value, "message_id", path),
    provider_group_id: readString(value, "provider_group_id", path),
    trace_id: readOptionalString(value, "trace_id", path),
    status: readString(value, "status", path),
    model_path: readArray(value, "model_path"),
    model_used: readOptionalString(value, "model_used", path),
    reasoning_effort: readString(value, "reasoning_effort", path),
    allowed_tools: readArray(value, "allowed_tools"),
    retrieval_refs: readArray(value, "retrieval_refs"),
    response_text: readOptionalString(value, "response_text", path),
    error: readOptionalString(value, "error", path),
    started_at: readString(value, "started_at", path),
    completed_at: readOptionalString(value, "completed_at", path),
  };
}

function toBackendMessageDecisionRead(value: unknown, path: string): BackendMessageDecisionRead {
  if (!isRecord(value)) {
    throw new KuunaApiClientError(`${path} must be an object`);
  }
  return {
    id: readString(value, "id", path),
    message_id: readString(value, "message_id", path),
    provider_group_id: readString(value, "provider_group_id", path),
    decision_type: readString(value, "decision_type", path),
    reason: readOptionalString(value, "reason", path),
    should_execute: readBoolean(value, "should_execute", path),
    payload: value.payload,
    created_at: readString(value, "created_at", path),
  };
}

function toBackendToolInvocationRead(value: unknown, path: string): BackendToolInvocationRead {
  if (!isRecord(value)) {
    throw new KuunaApiClientError(`${path} must be an object`);
  }
  return {
    id: readString(value, "id", path),
    agent_run_id: readOptionalString(value, "agent_run_id", path),
    message_id: readOptionalString(value, "message_id", path),
    provider_group_id: readString(value, "provider_group_id", path),
    tool_name: readString(value, "tool_name", path),
    ok: readBoolean(value, "ok", path),
    stdout: readString(value, "stdout", path),
    stderr: readString(value, "stderr", path),
    timed_out: readBoolean(value, "timed_out", path),
    duration_ms: readNumber(value, "duration_ms", path),
    details: value.details,
    created_at: readString(value, "created_at", path),
  };
}

function queryString(params: Record<string, string | undefined>): string {
  const text = Object.entries(params)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return text ? `?${text}` : "";
}

export class KuunaApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly groupTitleForProviderGroupId: (providerGroupId: string) => string;

  constructor(options: KuunaApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? defaultFetch();
    this.groupTitleForProviderGroupId =
      options.groupTitleForProviderGroupId ?? titleFromProviderGroupId;
  }

  async listTodos(params: BackendListParams = {}): Promise<TodoItem[]> {
    const items = assertArray(
      await this.getJson("/todos", {
        provider_group_id: params.providerGroupId,
      }),
      "/todos",
    ).map((item, index) => toBackendTodoRead(item, `/todos[${index}]`));

    return items.map((item) => ({
      id: item.id,
      providerGroupId: item.provider_group_id,
      groupTitle: this.groupTitleForProviderGroupId(item.provider_group_id),
      title: item.title,
      description: item.description ?? undefined,
      status: toTodoStatus(item.status),
      priority: toTodoPriority(item.priority),
      dueAt: item.due_at ?? undefined,
      exportedAt: item.exported_at ?? undefined,
      exportAttemptCount: item.export_attempt_count,
      externalRef: item.external_ref ?? undefined,
      lastExportError: item.last_export_error ?? undefined,
      updatedAt: item.updated_at,
    }));
  }

  async listAgentRuns(params: BackendListParams = {}): Promise<AgentRunRecord[]> {
    const items = assertArray(
      await this.getJson("/agent-runs", {
        provider_group_id: params.providerGroupId,
      }),
      "/agent-runs",
    ).map((item, index) => toBackendAgentRunRead(item, `/agent-runs[${index}]`));

    return items.map((item) => ({
      id: item.id,
      messageId: item.message_id ?? undefined,
      providerGroupId: item.provider_group_id,
      groupTitle: this.groupTitleForProviderGroupId(item.provider_group_id),
      traceId: item.trace_id ?? undefined,
      status: toAgentRunStatus(item.status),
      modelPath: compactStringList(item.model_path),
      modelUsed: item.model_used ?? undefined,
      reasoningEffort: item.reasoning_effort,
      allowedTools: compactStringList(item.allowed_tools),
      retrievalRefs: compactStringList(item.retrieval_refs),
      responseText: item.response_text ?? undefined,
      responsePreview: item.response_text?.slice(0, 220),
      error: item.error ?? undefined,
      startedAt: item.started_at,
      completedAt: item.completed_at ?? undefined,
    }));
  }

  async listMessageDecisions(
    params: BackendMessageDecisionListParams = {},
  ): Promise<MessageDecisionRecord[]> {
    const items = assertArray(
      await this.getJson("/message-decisions", {
        provider_group_id: params.providerGroupId,
        message_id: params.messageId,
      }),
      "/message-decisions",
    ).map((item, index) => toBackendMessageDecisionRead(item, `/message-decisions[${index}]`));

    return items.map((item) => ({
      id: item.id,
      messageId: item.message_id,
      providerGroupId: item.provider_group_id,
      groupTitle: this.groupTitleForProviderGroupId(item.provider_group_id),
      decisionType: item.decision_type,
      reason: item.reason ?? undefined,
      shouldExecute: item.should_execute,
      payloadSummary: summarizeJson(item.payload),
      createdAt: item.created_at,
    }));
  }

  async listToolInvocations(
    params: BackendToolInvocationListParams = {},
  ): Promise<ToolInvocationRecord[]> {
    const items = assertArray(
      await this.getJson("/tool-invocations", {
        provider_group_id: params.providerGroupId,
        agent_run_id: params.agentRunId,
      }),
      "/tool-invocations",
    ).map((item, index) => toBackendToolInvocationRead(item, `/tool-invocations[${index}]`));

    return items.map((item) => ({
      id: item.id,
      agentRunId: item.agent_run_id ?? undefined,
      messageId: item.message_id ?? undefined,
      providerGroupId: item.provider_group_id,
      groupTitle: this.groupTitleForProviderGroupId(item.provider_group_id),
      toolName: item.tool_name,
      ok: item.ok,
      stdout: item.stdout || undefined,
      stdoutPreview: summarizeJson(item.stdout, 160) || undefined,
      stderr: item.stderr || undefined,
      stderrPreview: summarizeJson(item.stderr, 160) || undefined,
      timedOut: item.timed_out,
      durationMs: item.duration_ms,
      detailsSummary: summarizeJson(item.details),
      createdAt: item.created_at,
    }));
  }

  private async getJson(path: string, params: Record<string, string | undefined>): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}${queryString(params)}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new KuunaApiClientError(
        `${path} failed with HTTP ${response.status}: ${body}`,
        response.status,
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new KuunaApiClientError(
        `${path} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export function createKuunaApiClient(options: KuunaApiClientOptions): KuunaApiClient {
  return new KuunaApiClient(options);
}

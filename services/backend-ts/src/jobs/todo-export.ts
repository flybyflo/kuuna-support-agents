import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { getSettings } from "../config.js";
import type { DbLike } from "../db/client.js";
import { todos } from "../db/schema.js";
import { logger } from "../logging.js";

type HttpClient = (url: string, init: RequestInit) => Promise<Response>;

type TodoRow = typeof todos.$inferSelect;

export async function processTodoExportJob(
  database: DbLike,
  input: { limit?: number; providerGroupId?: string | null } = {},
  options: {
    enabled?: boolean;
    webhookUrl?: string | null;
    timeoutSeconds?: number;
    httpClient?: HttpClient;
  } = {},
): Promise<number> {
  const settings = getSettings();
  const enabled = options.enabled ?? settings.TODO_EXPORT_ENABLED;
  if (!enabled) {
    logger.info("todo_export_disabled");
    return 0;
  }

  const webhookUrl = options.webhookUrl ?? settings.TODO_EXPORT_WEBHOOK_URL ?? null;
  if (!webhookUrl) {
    logger.warn("todo_export_webhook_missing");
    return 0;
  }

  const limit = Math.max(1, Math.min(input.limit ?? 100, 1000));
  const filters = [
    isNull(todos.exportedAt),
    inArray(todos.status, ["open", "in_progress"]),
    ...(input.providerGroupId ? [eq(todos.providerGroupId, input.providerGroupId)] : []),
  ];
  const rows = await database
    .select()
    .from(todos)
    .where(and(...filters))
    .orderBy(asc(todos.createdAt))
    .limit(limit);

  let exportedCount = 0;
  for (const todo of rows) {
    await database
      .update(todos)
      .set({
        exportAttemptCount: todo.exportAttemptCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(todos.id, todo.id));

    try {
      const externalRef = await postTodo(webhookUrl, todo, {
        timeoutSeconds: options.timeoutSeconds ?? settings.TODO_EXPORT_TIMEOUT_SECONDS,
        httpClient: options.httpClient ?? fetch,
      });
      await database
        .update(todos)
        .set({
          exportedAt: new Date(),
          externalRef,
          lastExportError: null,
          updatedAt: new Date(),
        })
        .where(eq(todos.id, todo.id));
      exportedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await database
        .update(todos)
        .set({
          lastExportError: message.slice(0, 1000),
          updatedAt: new Date(),
        })
        .where(eq(todos.id, todo.id));
      logger.warn("todo_export_failed", {
        todo_id: todo.id,
        provider_group_id: todo.providerGroupId,
        error: message,
      });
    }
  }

  return exportedCount;
}

async function postTodo(
  webhookUrl: string,
  todo: TodoRow,
  options: { timeoutSeconds: number; httpClient: HttpClient },
): Promise<string | null> {
  const response = await options.httpClient(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: todo.id,
      provider_group_id: todo.providerGroupId,
      message_id: todo.messageId,
      agent_run_id: todo.agentRunId,
      title: todo.title,
      description: todo.description,
      status: todo.status,
      priority: todo.priority,
      due_at: todo.dueAt?.toISOString() ?? null,
      created_at: todo.createdAt.toISOString(),
      updated_at: todo.updatedAt.toISOString(),
    }),
    signal: AbortSignal.timeout(options.timeoutSeconds * 1000),
  });

  if (!response.ok) {
    throw new Error(`todo_export_http_${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const text = await response.text();
  if (!text.trim()) return null;

  const payload = JSON.parse(text) as unknown;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const externalRef = record.external_ref ?? record.id;
    if (typeof externalRef === "string" && externalRef) {
      return externalRef;
    }
  }
  return null;
}

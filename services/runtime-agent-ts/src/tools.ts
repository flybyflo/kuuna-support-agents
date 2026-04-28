import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ToolExecutionResult, ToolInvocation } from "@kuuna/agent-contracts";

export const KUUNA_TOOL_NAMES = [
  "uppercase",
  "knowledge_search",
  "message_history",
  "todo_create",
  "todo_update",
  "todo_list",
] as const;

export type RuntimeToolState = {
  context: Record<string, unknown>;
  results: ToolExecutionResult[];
};

const knownToolNames = new Set<string>(KUUNA_TOOL_NAMES);

function textArg(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

function nowMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function pushResult(
  state: RuntimeToolState,
  startedAt: number,
  result: Omit<ToolExecutionResult, "duration_ms">,
): ToolExecutionResult {
  const completed = { ...result, duration_ms: nowMs(startedAt) };
  state.results.push(completed);
  return completed;
}

function contextArray(context: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = context[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

export function sanitizeAllowedTools(allowedTools: string[]): string[] {
  return allowedTools
    .map((tool) => tool.trim().toLowerCase())
    .filter((tool, index, tools) => knownToolNames.has(tool) && tools.indexOf(tool) === index);
}

export function createKuunaTools(state: RuntimeToolState): ToolDefinition[] {
  return [
    defineTool({
      name: "uppercase",
      label: "Uppercase",
      description: "Convert provided text to uppercase.",
      parameters: Type.Object({
        text: Type.String({ description: "Text to convert." }),
      }),
      execute: async (_toolCallId, params) => {
        const startedAt = Date.now();
        const stdout = params.text.toUpperCase();
        pushResult(state, startedAt, { name: "uppercase", ok: true, stdout, stderr: "", timed_out: false });
        return { content: [{ type: "text", text: stdout }], details: { text: params.text } };
      },
    }),
    defineTool({
      name: "knowledge_search",
      label: "Knowledge Search",
      description: "Read retrieved Kuuna knowledge snippets already scoped to this group.",
      parameters: Type.Object({
        query: Type.Optional(Type.String({ description: "Search query." })),
      }),
      execute: async (_toolCallId, params) => {
        const startedAt = Date.now();
        const hits = contextArray(state.context, ["retrieval_hits", "retrievalRefs", "retrieval_refs"]);
        const stdout = JSON.stringify({ query: params.query ?? "", hits });
        pushResult(state, startedAt, {
          name: "knowledge_search",
          ok: true,
          stdout,
          stderr: "",
          timed_out: false,
          details: { query: params.query ?? "", hit_count: hits.length },
        });
        return { content: [{ type: "text", text: stdout }], details: { hits } };
      },
    }),
    defineTool({
      name: "message_history",
      label: "Message History",
      description: "Read recent messages already scoped to this WhatsApp group.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: "Maximum number of messages." })),
      }),
      execute: async (_toolCallId, params) => {
        const startedAt = Date.now();
        const limit = typeof params.limit === "number" && params.limit > 0 ? Math.floor(params.limit) : 15;
        const messages = contextArray(state.context, ["recent_messages", "message_history"]).slice(0, limit);
        const stdout = JSON.stringify({ messages });
        pushResult(state, startedAt, {
          name: "message_history",
          ok: true,
          stdout,
          stderr: "",
          timed_out: false,
          details: { limit, message_count: messages.length },
        });
        return { content: [{ type: "text", text: stdout }], details: { messages } };
      },
    }),
    defineTool({
      name: "todo_create",
      label: "Create Todo",
      description: "Create a dashboard todo for the staff team.",
      parameters: Type.Object({
        title: Type.String({ description: "Short todo title." }),
        description: Type.Optional(Type.String({ description: "Todo details." })),
        priority: Type.Optional(Type.String({ description: "low, normal, high, or urgent." })),
        due_at: Type.Optional(Type.String({ description: "Optional due date/time." })),
      }),
      execute: async (_toolCallId, params) => {
        const startedAt = Date.now();
        const details = {
          operation: "create",
          title: params.title,
          description: params.description ?? "",
          priority: params.priority ?? "normal",
          due_at: params.due_at ?? null,
        };
        const stdout = JSON.stringify(details);
        pushResult(state, startedAt, {
          name: "todo_create",
          ok: true,
          stdout,
          stderr: "",
          timed_out: false,
          details,
        });
        return { content: [{ type: "text", text: stdout }], details };
      },
    }),
    defineTool({
      name: "todo_update",
      label: "Update Todo",
      description: "Update a dashboard todo for this group.",
      parameters: Type.Object({
        todo_id: Type.String({ description: "Todo id to update." }),
        title: Type.Optional(Type.String({ description: "New title." })),
        status: Type.Optional(Type.String({ description: "open, in_progress, done, or cancelled." })),
        description: Type.Optional(Type.String({ description: "New details." })),
        priority: Type.Optional(Type.String({ description: "low, normal, high, or urgent." })),
      }),
      execute: async (_toolCallId, params) => {
        const startedAt = Date.now();
        const details = { operation: "update", ...params };
        const stdout = JSON.stringify(details);
        pushResult(state, startedAt, {
          name: "todo_update",
          ok: true,
          stdout,
          stderr: "",
          timed_out: false,
          details,
        });
        return { content: [{ type: "text", text: stdout }], details };
      },
    }),
    defineTool({
      name: "todo_list",
      label: "List Todos",
      description: "Read open todos already scoped to this group.",
      parameters: Type.Object({
        status: Type.Optional(Type.String({ description: "Optional status filter." })),
      }),
      execute: async (_toolCallId, params) => {
        const startedAt = Date.now();
        const todos = contextArray(state.context, ["todos"]);
        const status = params.status;
        const filtered =
          typeof status === "string" && status
            ? todos.filter((todo) => {
                if (typeof todo !== "object" || todo === null) return false;
                return (todo as Record<string, unknown>).status === status;
              })
            : todos;
        const stdout = JSON.stringify({ todos: filtered });
        pushResult(state, startedAt, {
          name: "todo_list",
          ok: true,
          stdout,
          stderr: "",
          timed_out: false,
          details: { status: status ?? null, todo_count: filtered.length },
        });
        return { content: [{ type: "text", text: stdout }], details: { todos: filtered } };
      },
    }),
  ];
}

export function executeExplicitTool(
  invocation: ToolInvocation,
  allowedTools: string[],
  context: Record<string, unknown>,
): ToolExecutionResult {
  const startedAt = Date.now();
  const name = invocation.name.trim().toLowerCase();
  if (!sanitizeAllowedTools(allowedTools).includes(name)) {
    return {
      name,
      ok: false,
      stdout: "",
      stderr: `Tool '${name}' is not allowed.`,
      timed_out: false,
      duration_ms: nowMs(startedAt),
    };
  }

  const args = invocation.arguments ?? {};
  if (name === "uppercase") {
    return {
      name,
      ok: true,
      stdout: textArg(args, ["text", "input", "value"]).toUpperCase(),
      stderr: "",
      timed_out: false,
      duration_ms: nowMs(startedAt),
    };
  }

  if (name === "knowledge_search") {
    return {
      name,
      ok: true,
      stdout: JSON.stringify({ hits: contextArray(context, ["retrieval_hits", "retrieval_refs"]) }),
      stderr: "",
      timed_out: false,
      duration_ms: nowMs(startedAt),
    };
  }

  if (name === "message_history") {
    return {
      name,
      ok: true,
      stdout: JSON.stringify({ messages: contextArray(context, ["recent_messages", "message_history"]) }),
      stderr: "",
      timed_out: false,
      duration_ms: nowMs(startedAt),
    };
  }

  return {
    name,
    ok: false,
    stdout: "",
    stderr: `Tool '${name}' can only be executed by the agent.`,
    timed_out: false,
    duration_ms: nowMs(startedAt),
  };
}

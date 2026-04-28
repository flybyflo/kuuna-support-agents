import { z } from "zod";

export const DEFAULT_AGENT_MODEL = "gpt-5.5";
export const DEFAULT_REASONING_EFFORT = "medium";

export const reasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export const toolInvocationSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.unknown()).default({}),
  timeout_seconds: z.number().nonnegative().nullable().optional(),
});

export const runtimeAgentRequestSchema = z.object({
  trace_id: z.string().nullable().optional(),
  system_prompt: z.string().nullable().optional(),
  user_prompt: z.string(),
  context: z.record(z.unknown()).default({}),
  model_path: z.array(z.string().min(1)).default([]),
  reasoning_effort: reasoningEffortSchema.default(DEFAULT_REASONING_EFFORT),
  allowed_tools: z.array(z.string().min(1)).default([]),
  tool_requests: z.array(toolInvocationSchema).default([]),
});

export const modelAttemptSchema = z.object({
  model: z.string(),
  success: z.boolean(),
  error: z.string().nullable().optional(),
});

export const toolExecutionResultSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  stdout: z.string().default(""),
  stderr: z.string().default(""),
  timed_out: z.boolean().default(false),
  duration_ms: z.number().int().nonnegative().default(0),
  details: z.record(z.unknown()).nullable().optional(),
});

export const runtimeAgentResultSchema = z.object({
  success: z.boolean(),
  prompt: z.string(),
  system_prompt: z.string(),
  user_prompt: z.string(),
  context_block: z.string().nullable().optional(),
  model_used: z.string().nullable().optional(),
  reasoning_effort: reasoningEffortSchema.default(DEFAULT_REASONING_EFFORT),
  attempts: z.array(modelAttemptSchema).default([]),
  response_text: z.string().nullable().optional(),
  tool_results: z.array(toolExecutionResultSchema).default([]),
  error: z.string().nullable().optional(),
});

export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export type ToolInvocation = z.infer<typeof toolInvocationSchema>;
export type RuntimeAgentRequest = z.infer<typeof runtimeAgentRequestSchema>;
export type ModelAttempt = z.infer<typeof modelAttemptSchema>;
export type ToolExecutionResult = z.infer<typeof toolExecutionResultSchema>;
export type RuntimeAgentResult = z.infer<typeof runtimeAgentResultSchema>;

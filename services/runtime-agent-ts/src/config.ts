import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_REASONING_EFFORT,
  type ReasoningEffort,
} from "@kuuna/agent-contracts";

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_HOST = "::";
export const DEFAULT_PORT = 8100;
export const MAX_MODEL_ATTEMPTS = 2;

export function port(): number {
  const value = Number.parseInt(process.env.PORT ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PORT;
}

export function host(): string {
  return process.env.HOST?.trim() || DEFAULT_HOST;
}

export function openAiApiKey(): string | undefined {
  const value = process.env.OPENAI_API_KEY?.trim();
  return value || undefined;
}

export function openAiBaseUrl(): string {
  const value = process.env.OPENAI_BASE_URL?.trim();
  return (value || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
}

export function openAiTimeoutSeconds(): string {
  return process.env.OPENAI_TIMEOUT_SECONDS ?? "30";
}

export function defaultModel(): string {
  return process.env.RUNTIME_AGENT_DEFAULT_MODEL?.trim() || DEFAULT_AGENT_MODEL;
}

export function defaultReasoningEffort(): ReasoningEffort {
  const value = process.env.RUNTIME_AGENT_REASONING_EFFORT?.trim();
  if (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  return DEFAULT_REASONING_EFFORT;
}

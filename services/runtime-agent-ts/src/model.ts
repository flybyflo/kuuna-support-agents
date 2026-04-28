import { getModel, type Model } from "@mariozechner/pi-ai";
import type { ReasoningEffort } from "@kuuna/agent-contracts";
import { defaultModel, defaultReasoningEffort, MAX_MODEL_ATTEMPTS, openAiBaseUrl } from "./config.js";

export function normalizeModelName(modelName: string): string {
  const trimmed = modelName.trim();
  if (!trimmed) {
    return "";
  }
  for (const prefix of ["openai/", "openai:"]) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }
  return trimmed;
}

export function modelPath(candidates: string[]): string[] {
  const normalized = candidates
    .map(normalizeModelName)
    .filter((candidate) => candidate.length > 0);
  const unique = normalized.filter((candidate, index) => normalized.indexOf(candidate) === index);
  return (unique.length ? unique : [defaultModel()]).slice(0, MAX_MODEL_ATTEMPTS);
}

export function piThinkingLevel(effort: ReasoningEffort | undefined): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" {
  const selected = effort ?? defaultReasoningEffort();
  return selected === "none" ? "off" : selected;
}

export function getOpenAiModel(modelName: string): Model<any> | undefined {
  const model = getModel("openai", normalizeModelName(modelName) as any);
  if (!model) {
    return undefined;
  }
  return { ...model, baseUrl: openAiBaseUrl() };
}

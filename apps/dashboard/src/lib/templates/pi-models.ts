export type PiModelOption = {
  id: string;
  name: string;
  reasoning: boolean;
};

export const PI_OPENAI_MODELS: PiModelOption[] = [
  { id: "gpt-4", name: "GPT-4", reasoning: false },
  { id: "gpt-4-turbo", name: "GPT-4 Turbo", reasoning: false },
  { id: "gpt-4.1", name: "GPT-4.1", reasoning: false },
  { id: "gpt-4.1-mini", name: "GPT-4.1 mini", reasoning: false },
  { id: "gpt-4.1-nano", name: "GPT-4.1 nano", reasoning: false },
  { id: "gpt-4o", name: "GPT-4o", reasoning: false },
  { id: "gpt-4o-2024-05-13", name: "GPT-4o (2024-05-13)", reasoning: false },
  { id: "gpt-4o-2024-08-06", name: "GPT-4o (2024-08-06)", reasoning: false },
  { id: "gpt-4o-2024-11-20", name: "GPT-4o (2024-11-20)", reasoning: false },
  { id: "gpt-4o-mini", name: "GPT-4o mini", reasoning: false },
  { id: "gpt-5", name: "GPT-5", reasoning: true },
  { id: "gpt-5-chat-latest", name: "GPT-5 Chat Latest", reasoning: false },
  { id: "gpt-5-codex", name: "GPT-5-Codex", reasoning: true },
  { id: "gpt-5-mini", name: "GPT-5 Mini", reasoning: true },
  { id: "gpt-5-nano", name: "GPT-5 Nano", reasoning: true },
  { id: "gpt-5-pro", name: "GPT-5 Pro", reasoning: true },
  { id: "gpt-5.1", name: "GPT-5.1", reasoning: true },
  { id: "gpt-5.1-chat-latest", name: "GPT-5.1 Chat", reasoning: true },
  { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", reasoning: true },
  { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", reasoning: true },
  { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex mini", reasoning: true },
  { id: "gpt-5.2", name: "GPT-5.2", reasoning: true },
  { id: "gpt-5.2-chat-latest", name: "GPT-5.2 Chat", reasoning: true },
  { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", reasoning: true },
  { id: "gpt-5.2-pro", name: "GPT-5.2 Pro", reasoning: true },
  { id: "gpt-5.3-chat-latest", name: "GPT-5.3 Chat (latest)", reasoning: false },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", reasoning: true },
  { id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark", reasoning: true },
  { id: "gpt-5.4", name: "GPT-5.4", reasoning: true },
  { id: "gpt-5.4-mini", name: "GPT-5.4 mini", reasoning: true },
  { id: "gpt-5.4-nano", name: "GPT-5.4 nano", reasoning: true },
  { id: "gpt-5.4-pro", name: "GPT-5.4 Pro", reasoning: true },
  { id: "gpt-5.5", name: "GPT-5.5", reasoning: true },
  { id: "o1", name: "o1", reasoning: true },
  { id: "o1-pro", name: "o1-pro", reasoning: true },
  { id: "o3", name: "o3", reasoning: true },
  { id: "o3-deep-research", name: "o3-deep-research", reasoning: true },
  { id: "o3-mini", name: "o3-mini", reasoning: true },
  { id: "o3-pro", name: "o3-pro", reasoning: true },
  { id: "o4-mini", name: "o4-mini", reasoning: true },
  { id: "o4-mini-deep-research", name: "o4-mini-deep-research", reasoning: true },
];

export function isPiOpenAiModel(modelId: string): boolean {
  return PI_OPENAI_MODELS.some((model) => model.id === modelId);
}

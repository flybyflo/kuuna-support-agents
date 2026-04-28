const triggerPrefixes = ["kuuna:", "/kuuna", "!kuuna"] as const;
const defaultAliases = ["agent", "kuuna"] as const;

export type TriggerDecision = {
  shouldExecute: boolean;
  reason: string;
  triggerType: "mention" | "reply" | "prefix" | null;
};

export type TriggerEvent = {
  message: {
    text?: string | null;
    reply_to_provider_message_id?: string | null;
    mentions: string[];
  };
};

export function evaluateTrigger(event: TriggerEvent): TriggerDecision {
  if (hasAgentMention(event)) {
    return { shouldExecute: true, reason: "agent_mention_present", triggerType: "mention" };
  }
  if (event.message.reply_to_provider_message_id) {
    return {
      shouldExecute: true,
      reason: "reply_to_provider_message_id_present",
      triggerType: "reply",
    };
  }
  const text = (event.message.text ?? "").trimStart();
  if (triggerPrefixes.some((prefix) => text.startsWith(prefix))) {
    return { shouldExecute: true, reason: "prefix_match", triggerType: "prefix" };
  }
  return { shouldExecute: false, reason: "no_trigger_match", triggerType: null };
}

function configuredCsvValues(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((value) => normalizeMention(value))
      .filter(Boolean),
  );
}

function normalizeMention(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function hasAgentMention(event: TriggerEvent): boolean {
  const configuredIds = configuredCsvValues("AGENT_MENTION_IDS");
  const aliases = new Set([...defaultAliases, ...configuredCsvValues("AGENT_MENTION_ALIASES")]);

  for (const mention of event.message.mentions) {
    const normalized = normalizeMention(mention);
    if (configuredIds.size > 0 && configuredIds.has(normalized)) return true;
    if (aliases.has(normalized)) return true;
  }

  const text = event.message.text ?? "";
  for (const alias of aliases) {
    if (new RegExp(`(^|\\s)@${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\b|[^\\w])`, "i").test(text)) {
      return true;
    }
  }
  return false;
}

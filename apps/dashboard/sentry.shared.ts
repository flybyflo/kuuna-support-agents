const SENSITIVE_KEY_PARTS = [
  "password",
  "authorization",
  "token",
  "secret",
  "api_key",
  "cookie",
  "set-cookie",
  "raw_event",
  "download_url",
  "inline_data_base64",
  "text_content",
  "body",
  "message",
  "content",
] as const;

const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{20,}\b/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function containsSensitiveKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => lowered.includes(part));
}

function scrubString(value: string): string {
  return value.replace(OPENAI_KEY_PATTERN, "[REDACTED]");
}

function scrubValue(key: string, value: unknown): unknown {
  if (containsSensitiveKey(key)) {
    return "[REDACTED]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(key, item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, scrubValue(childKey, childValue)]),
    );
  }

  if (typeof value === "string") {
    return scrubString(value);
  }

  return value;
}

export function scrubSentryEvent<T>(event: T): T {
  if (!isRecord(event)) {
    return event;
  }

  return scrubValue("event", event) as T;
}

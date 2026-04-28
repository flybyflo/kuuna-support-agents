const sensitiveKeyParts = [
  "password",
  "authorization",
  "token",
  "secret",
  "api_key",
  "raw_event",
  "download_url",
  "inline_data_base64",
  "text_content",
];

const openAiKeyPattern = /\bsk-[A-Za-z0-9]{20,}\b/g;

export type LogFields = Record<string, unknown>;

function containsSensitiveKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return sensitiveKeyParts.some((part) => lowered.includes(part));
}

export function scrubValue(key: string, value: unknown): unknown {
  if (containsSensitiveKey(key)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    return value.replace(openAiKeyPattern, "[REDACTED]");
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(key, item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        scrubValue(entryKey, entryValue),
      ]),
    );
  }

  return value;
}

export function scrubFields(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, scrubValue(key, value)]),
  );
}

function write(level: string, message: string, fields: LogFields = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    logger: "backend-ts",
    message,
    ...scrubFields(fields),
  };
  const line = JSON.stringify(entry);
  if (level === "ERROR") {
    process.stderr.write(`${line}\n`);
    return;
  }
  process.stdout.write(`${line}\n`);
}

export const logger = {
  info: (message: string, fields?: LogFields) => write("INFO", message, fields),
  warn: (message: string, fields?: LogFields) => write("WARNING", message, fields),
  error: (message: string, fields?: LogFields) => write("ERROR", message, fields),
};

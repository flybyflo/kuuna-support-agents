import { z } from "zod";

const envSchema = z.object({
  APP_ENV: z.string().default("dev"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8010),
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/kuuna"),
  REDIS_URL: z.string().default("redis://localhost:6379/0"),
  SENTRY_DSN: z.string().optional(),
  INTERNAL_OPS_TOKEN: z.string().optional(),
  AUTH_TOKEN_SECRET: z.string().default("dev-insecure-change-me"),
  AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  AUTH_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_SECONDS: z.coerce.number().int().positive().default(900),
  AUTH_PASSWORD_MIN_LENGTH: z.coerce.number().int().positive().default(12),
  AUTH_PASSWORD_MAX_CONSECUTIVE: z.coerce.number().int().positive().default(3),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(20),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_TIMEOUT_SECONDS: z.coerce.number().positive().default(30),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  GATEWAY_BASE_URL: z.string().default("http://gateway:8090"),
  GATEWAY_SERVICE_TOKEN: z.string().optional(),
  OUTBOUND_DISPATCH_TIMEOUT_SECONDS: z.coerce.number().positive().default(10),
  TODO_EXPORT_ENABLED: z.coerce.boolean().default(false),
  TODO_EXPORT_WEBHOOK_URL: z.string().optional(),
  TODO_EXPORT_TIMEOUT_SECONDS: z.coerce.number().positive().default(20),
});

export type Settings = z.infer<typeof envSchema>;

let cachedSettings: Settings | undefined;

export function getSettings(): Settings {
  if (!cachedSettings) {
    cachedSettings = envSchema.parse(process.env);
  }
  return cachedSettings;
}

export function resetSettingsForTests(): void {
  cachedSettings = undefined;
}

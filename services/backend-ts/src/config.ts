import { z } from "zod";

const envSchema = z.object({
  APP_ENV: z.string().default("dev"),
  HOST: z.string().default("::"),
  PORT: z.coerce.number().int().positive().default(8010),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://postgres:postgres@127.0.0.1:5432/kuuna"),
  REDIS_URL: z.string().default("redis://localhost:6379/0"),
  SENTRY_DSN: z.string().optional(),
  INTERNAL_OPS_TOKEN: z.string().optional(),
  REQUIRED_ADMIN_EMAIL: z.string().email().default("admin@kuuna.ai"),
  DASHBOARD_REQUIRED_ADMIN_PASSWORD: z.string().default("admin123456!"),
  DASHBOARD_DEV_RESET_BOOTSTRAP_ADMIN_PASSWORD: z.coerce.boolean().default(false),
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
  OPENAI_AUDIO_TRANSCRIPTION_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  OPENAI_VISION_MODEL: z.string().default("gpt-4.1-mini"),
  S3_ENDPOINT_URL: z.string().optional(),
  S3_BUCKET: z.string().default("kuuna-dev"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_PUBLIC_BASE_URL: z.string().optional(),
  MEDIA_PROCESSING_ENABLED: z.coerce.boolean().default(true),
  MEDIA_DOWNLOAD_TIMEOUT_SECONDS: z.coerce.number().positive().default(20),
  GATEWAY_BASE_URL: z.string().default("http://gateway:8090"),
  GATEWAY_SERVICE_TOKEN: z.string().optional(),
  GATEWAY_OPS_TOKEN: z.string().optional(),
  OUTBOUND_DISPATCH_TIMEOUT_SECONDS: z.coerce.number().positive().default(10),
  TODO_EXPORT_ENABLED: z.coerce.boolean().default(false),
  TODO_EXPORT_WEBHOOK_URL: z.string().optional(),
  TODO_EXPORT_TIMEOUT_SECONDS: z.coerce.number().positive().default(20),
  TEMPLATE_BUILD_CONTEXT_PATH: z.string().default("."),
  TEMPLATE_BUILD_GONDOLIN_CONFIG_PATH: z.string().default(""),
  RUNTIME_AGENT_TIMEOUT_SECONDS: z.coerce.number().positive().default(300),
  RUNTIME_GONDOLIN_ASSET_REF: z.string().default(""),
  RUNTIME_GONDOLIN_DATA_ROOT: z.string().default(".kuuna/gondolin/runtime-data"),
  RUNTIME_GONDOLIN_BUILD_ROOT: z.string().default(".kuuna/gondolin/template-builds"),
  RUNTIME_GONDOLIN_ROOTFS_MODE: z.enum(["readonly", "memory", "cow"]).default("cow"),
  RUNTIME_GONDOLIN_ALLOWED_HOSTS_JSON: z.string().default(JSON.stringify(["api.openai.com", "localhost", "127.0.0.1"])),
  RUNTIME_GONDOLIN_TCP_MAP_JSON: z.string().optional(),
  RUNTIME_GONDOLIN_START_COMMAND: z.string().default("node dist/src/server.js"),
  RUNTIME_AGENT_CONTAINER_PORT: z.coerce.number().int().positive().default(8100),
  RUNTIME_TOOL_BACKEND_BASE_URL: z.string().default("http://127.0.0.1:8000"),
  RUNTIME_TOOL_TOKEN: z.string().optional(),
  RUNTIME_CONTAINER_DATA_DIR: z.string().default("/runtime-data"),
  RUNTIME_CONTAINER_EXTRA_ENV_JSON: z.string().optional(),
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

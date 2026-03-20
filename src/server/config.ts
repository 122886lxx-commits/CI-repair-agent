import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://127.0.0.1:3000"),
  AUTH_BYPASS: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  SESSION_SECRET: z.string().default("local-development-session-secret"),
  ALLOWED_GITHUB_ORGS: z.string().default(""),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1"),
  DATABASE_URL: z.string().default(""),
  SANDBOX_IMAGE: z.string().default("node:22-bookworm"),
  LIVE_SANDBOX: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  SANDBOX_NETWORK_DISABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  GIT_AUTHOR_NAME: z.string().default("CI Repair Agent"),
  GIT_AUTHOR_EMAIL: z.string().email().default("ci-repair-agent@example.com")
});

export type AppConfig = z.infer<typeof envSchema>;

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = envSchema.parse(process.env);
  return cachedConfig;
}

export function isAuthBypassed() {
  const config = getConfig();
  return config.NODE_ENV !== "production" && config.AUTH_BYPASS;
}

export function getAllowedGithubOrgs() {
  const config = getConfig();
  return config.ALLOWED_GITHUB_ORGS.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

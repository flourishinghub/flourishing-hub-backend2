import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const splitCsv = (value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default("/api/v1"),
  APP_NAME: z.string().default("Flourish Hub Backend"),
  CLIENT_URL: z.string().default("http://localhost:3000"),
  CLIENT_URLS: z
    .string()
    .optional()
    .transform((value) => (value ? splitCsv(value) : [])),
  TRUST_PROXY: z.union([z.string(), z.coerce.number(), z.boolean()]).default(1),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(10),
  JWT_REFRESH_SECRET: z.string().min(10),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(30),
  CACHE_TTL_SECONDS: z.coerce.number().default(60)
});

const parsedEnv = envSchema.parse(process.env);

export const env = {
  ...parsedEnv,
  CLIENT_URLS: parsedEnv.CLIENT_URLS.length ? parsedEnv.CLIENT_URLS : [parsedEnv.CLIENT_URL]
};




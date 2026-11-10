import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse({ NODE_ENV: process.env.NODE_ENV });

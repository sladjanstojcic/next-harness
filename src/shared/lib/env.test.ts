import { expect, test } from "vitest";
import { env, envSchema } from "./env";

test.each(["development", "production", "test"])("accepts NODE_ENV=%s", (mode) => {
  expect(envSchema.parse({ NODE_ENV: mode })).toEqual({ NODE_ENV: mode });
});

test("rejects an unknown NODE_ENV", () => {
  expect(envSchema.safeParse({ NODE_ENV: "x" }).success).toBe(false);
});

test("exports the parsed test environment", () => {
  expect(env).toEqual({ NODE_ENV: "test" });
});

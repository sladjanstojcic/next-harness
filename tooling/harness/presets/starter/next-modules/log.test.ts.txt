import { afterEach, expect, test, vi } from "vitest";
import { logError } from "./log";

afterEach(() => vi.restoreAllMocks());

test("logs an error with context", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = new Error("db down");

  logError(error, { operation: "save" });

  expect(output).toHaveBeenCalledExactlyOnceWith(error, { operation: "save" });
});

test("logs unknown errors without context", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});

  logError("db down");

  expect(output).toHaveBeenCalledExactlyOnceWith("db down", {});
});

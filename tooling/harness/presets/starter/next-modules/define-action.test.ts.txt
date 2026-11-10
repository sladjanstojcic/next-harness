import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { defineAction } from "./define-action";
import * as logger from "./log";
import { UserError } from "./user-error";

afterEach(() => vi.restoreAllMocks());

test("returns data for valid input", async () => {
  const action = defineAction(z.object({ name: z.string() }), async ({ name }) => ({ greeting: `Hello, ${name}!` }));

  await expect(action({ name: "Ada" })).resolves.toEqual({ ok: true, data: { greeting: "Hello, Ada!" } });
});

test("rejects invalid input", async () => {
  let called = false;
  const action = defineAction(z.object({ name: z.string() }), async () => {
    called = true;
    return "saved";
  });

  await expect(action({ name: 42 })).resolves.toEqual({ ok: false, error: "Invalid input." });
  expect(called).toBe(false);
});

test("passes a UserError message through", async () => {
  const log = vi.spyOn(logger, "logError").mockImplementation(() => {});
  const action = defineAction(z.string(), async () => {
    throw new UserError("Name is taken.");
  });

  await expect(action("Ada")).resolves.toEqual({ ok: false, error: "Name is taken." });
  expect(log).not.toHaveBeenCalled();
});

test("hides an unexpected error", async () => {
  const error = new Error("db down");
  const log = vi.spyOn(logger, "logError").mockImplementation(() => {});
  const action = defineAction(z.string(), async () => {
    throw error;
  });

  await expect(action("Ada")).resolves.toEqual({ ok: false, error: "Something went wrong." });
  expect(log).toHaveBeenCalledExactlyOnceWith(error);
});

test("passes parsed output to the handler", async () => {
  const action = defineAction(
    z.string().transform((value) => value.length),
    async (length) => length * 2,
  );

  await expect(action("Ada")).resolves.toEqual({ ok: true, data: 6 });
});

test("validates asynchronous schemas before calling the handler", async () => {
  const action = defineAction(
    z.string().refine(async (value) => value === "allowed"),
    async (value) => value,
  );

  await expect(action("denied")).resolves.toEqual({ ok: false, error: "Invalid input." });
  await expect(action("allowed")).resolves.toEqual({ ok: true, data: "allowed" });
});

test("hides unexpected validation exceptions", async () => {
  const error = new Error("validation dependency failed");
  const log = vi.spyOn(logger, "logError").mockImplementation(() => {});
  const action = defineAction(
    z.string().transform(() => {
      throw error;
    }),
    async (value) => value,
  );

  await expect(action("Ada")).resolves.toEqual({ ok: false, error: "Something went wrong." });
  expect(log).toHaveBeenCalledExactlyOnceWith(error);
});

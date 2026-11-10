import type { z } from "zod";
import { logError } from "./log";
import { toUserMessage, UserError } from "./user-error";

export type ActionResult<R> = { ok: true; data: R } | { ok: false; error: string };

export function defineAction<S extends z.ZodType, R>(schema: S, handler: (input: z.infer<S>) => Promise<R>): (input: unknown) => Promise<ActionResult<R>> {
  return async (input: unknown): Promise<ActionResult<R>> => {
    try {
      const parsed = await schema.safeParseAsync(input);
      if (!parsed.success) {
        return { ok: false, error: "Invalid input." };
      }

      return { ok: true, data: await handler(parsed.data) };
    } catch (error) {
      if (!(error instanceof UserError)) {
        logError(error);
      }
      return { ok: false, error: toUserMessage(error) };
    }
  };
}

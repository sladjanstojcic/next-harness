import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

const entry = z.looseObject({ matcher: z.string().optional(), hooks: z.array(z.looseObject({ command: z.string().optional() })) });
export const hooksBlock = z.record(z.string(), z.array(entry));

type Entry = z.infer<typeof entry>;
export type HooksBlock = Record<string, Entry[]>;

const HARNESS_HOOK = /tooling\/harness\/cli\.ts"?\s+hook\b/;

function split(entries: readonly Entry[], harness: boolean): Entry[] {
  return entries.flatMap((item) => {
    const hooks = item.hooks.filter((hook) => (hook.command !== undefined && HARNESS_HOOK.test(hook.command)) === harness);
    return hooks.length === 0 ? [] : [{ ...item, hooks }];
  });
}

function events(current: HooksBlock, wanted: HooksBlock): string[] {
  return [...new Set([...Object.keys(wanted), ...Object.keys(current)])];
}

export interface HooksComparison {
  /** Events whose harness entries are missing or differ from the wanted ones. */
  differing: string[];
  /** Whether the current block holds any harness hook at all. */
  hasHarness: boolean;
  /** Hook entries that are not the harness's and survive a merge. */
  kept: number;
}

export function compareHooks(current: HooksBlock, wanted: HooksBlock): HooksComparison {
  const all = events(current, wanted);
  return {
    differing: all.filter((event) => !isDeepStrictEqual(split(current[event] ?? [], true), wanted[event] ?? [])),
    hasHarness: all.some((event) => split(current[event] ?? [], true).length > 0),
    kept: all.reduce((sum, event) => sum + split(current[event] ?? [], false).length, 0),
  };
}

/** Puts the wanted harness entries first in each event and keeps every hook that is not the harness's. */
export function mergeHooks(current: HooksBlock, wanted: HooksBlock): HooksBlock {
  const merged: HooksBlock = {};
  for (const event of events(current, wanted)) {
    const entries = [...(wanted[event] ?? []), ...split(current[event] ?? [], false)];
    if (entries.length > 0) merged[event] = entries;
  }
  return merged;
}

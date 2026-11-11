import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import { compilerOptionsInForce } from "../../tools/typescript.ts";
import { resolveHarness } from "../path-check.ts";
import type { Finding } from "./finding.ts";

/** The shapes whose type check the harness relies on; the Makerkit and supabase shapes keep the kit's own settings. */
const JUDGED = ["next-modules", "package"];

/**
 * A workspace's tool configs may be created by an agent while the workspace is new, so its type check must not be
 * switched off there: `strict` is on in the options in force, with every file the tsconfig extends, and neither
 * `noImplicitAny` nor `strictNullChecks` is turned off beside it. `skipLibCheck` is not judged.
 */
export function auditTsconfigs(root: string): Finding[] {
  return resolveHarness(root)
    .workspaces.filter((workspace) => JUDGED.includes(workspace.shape))
    .flatMap((workspace): Finding[] => {
      const file = posix.join(workspace.path, "tsconfig.json");
      if (!existsSync(join(root, file))) return [];
      const options = compilerOptionsInForce(join(root, file));
      if (options === undefined) return [];
      const off = [
        ...(options.strict === true ? [] : ["strict"]),
        ...(options.noImplicitAny === false ? ["noImplicitAny"] : []),
        ...(options.strictNullChecks === false ? ["strictNullChecks"] : []),
      ];
      return off.map((option) => ({
        rule: "tsconfig-strict",
        file,
        message: `compilerOptions.${option} is off in the options in force for this tsconfig.json, with what it extends. Set "strict": true and leave noImplicitAny and strictNullChecks on; fix the type errors instead.`,
      }));
    });
}

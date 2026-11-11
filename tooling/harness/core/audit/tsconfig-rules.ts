import { existsSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { tsconfigInForce, type TsconfigInForce } from "../../tools/typescript.ts";
import { resolveHarness } from "../path-check.ts";
import type { Finding } from "./finding.ts";

/** The shapes whose type check the harness relies on; the Makerkit and supabase shapes keep the kit's own settings. */
const JUDGED = ["next-modules", "package", "electron-vite"];

function judge(file: string, config: TsconfigInForce): Finding[] {
  const name = posix.basename(file);
  if (config.checksNothing) {
    const message = `This ${name} checks no files ("files": [] and no "include"), and the harness's tsc step reads this file, so nothing in the workspace is type-checked. Give it the sources in "include" with "strict": true.`;
    return [{ rule: "tsconfig-strict", file, message }];
  }
  const { options } = config;
  const off = [
    ...(options.strict === true ? [] : ["strict"]),
    ...(options.noImplicitAny === false ? ["noImplicitAny"] : []),
    ...(options.strictNullChecks === false ? ["strictNullChecks"] : []),
  ];
  const findings = off.map((option) => ({
    rule: "tsconfig-strict",
    file,
    message: `compilerOptions.${option} is off in the options in force for this ${name}, with what it extends. Set "strict": true and leave noImplicitAny and strictNullChecks on; fix the type errors instead.`,
  }));
  if (options.noCheck !== true) return findings;
  const noCheck = `compilerOptions.noCheck is on in the options in force for this ${name}, which turns the type check off. Remove it; fix the type errors instead.`;
  return [...findings, { rule: "tsconfig-strict", file, message: noCheck }];
}

/**
 * A workspace's tool configs may be created by an agent while the workspace is new, so its type check must not be
 * switched off there: `strict` is on in the options in force, with every file the tsconfig extends, and neither
 * `noImplicitAny` nor `strictNullChecks` is turned off beside it, `noCheck` is not set, and the file names sources to
 * check. `skipLibCheck` is not judged.
 */
export function auditTsconfigs(root: string): Finding[] {
  return resolveHarness(root)
    .workspaces.filter((workspace) => JUDGED.includes(workspace.shape))
    .flatMap((workspace): Finding[] => {
      const file = posix.join(workspace.path, "tsconfig.json");
      if (!existsSync(join(root, file))) return [];
      const config = tsconfigInForce(join(root, file));
      if (config === undefined) return [];
      // An electron-vite workspace is type-checked project by project, so each project it refers to is the one judged.
      if (workspace.shape !== "electron-vite" || !config.checksNothing || config.references.length === 0) return judge(file, config);
      return config.references.flatMap((reference) => {
        const referenced = tsconfigInForce(reference);
        return referenced === undefined
          ? []
          : judge(posix.join(workspace.path, relative(join(root, workspace.path), reference).split(sep).join("/")), referenced);
      });
    });
}

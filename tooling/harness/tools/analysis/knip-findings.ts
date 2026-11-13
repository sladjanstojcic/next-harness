import { z } from "zod";
import type { Finding } from "../../core/audit/finding.ts";
import { ALL_NAMES } from "../../core/package-usage.ts";
import { relativePath } from "../tool-set.ts";

const knipOutput = z.object({ issues: z.array(z.object({ file: z.string() }).catchall(z.array(z.unknown()))) });

/** What each kind of knip issue is, in words; the entry's name follows. */
const KNIP_KINDS: Readonly<Record<string, string>> = {
  files: "unused file",
  exports: "unused export",
  types: "unused exported type",
  dependencies: "unused dependency",
  devDependencies: "unused devDependency",
  binaries: "unlisted binary",
  unlisted: "unlisted dependency",
  unresolved: "unresolved import",
};
const knipEntry = z.object({ name: z.string(), line: z.number().optional() });

/** Entry file to the names another workspace imports from it; see core/package-usage.ts. */
export type UsedElsewhere = ReadonlyMap<string, ReadonlySet<string>>;

export function knipFindings(root: string, stdout: string, usedElsewhere?: () => UsedElsewhere): Finding[] {
  // Knip names an unused public export in the file that defines it, not in the entry that re-exports it, so a name
  // another workspace imports from any entry counts wherever the package exports it.
  const used = new Set([...(usedElsewhere?.() ?? new Map<string, ReadonlySet<string>>()).values()].flatMap((names) => [...names]));
  const isUsed = (kind: string, name: string): boolean => (kind === "exports" || kind === "types") && (used.has(name) || used.has(ALL_NAMES));
  const value: unknown = JSON.parse(stdout);
  const unusedDependency = "Remove the unused dependency from package.json or use it in the application.";
  const guidance: Record<string, string> = {
    files: "Remove the unused file or import it from an entry point.",
    exports: "Remove the unused export or import it where it is used.",
    dependencies: unusedDependency,
    devDependencies: unusedDependency,
  };
  return knipOutput.parse(value).issues.flatMap(({ file, ...issues }) =>
    Object.entries(issues)
      .filter(([kind]) => kind !== "owners")
      .flatMap(([kind, entries]) =>
        entries.flatMap((entry): Finding[] => {
          const named = knipEntry.safeParse(entry);
          if (named.success && isUsed(kind, named.data.name)) return [];
          const what = `${KNIP_KINDS[kind] ?? kind}${named.success ? ` ${named.data.name}` : `: ${JSON.stringify(entry)}`}`;
          const finding: Finding = {
            rule: `knip-${kind}`,
            file: relativePath(root, file),
            ...(named.success && named.data.line !== undefined ? { line: named.data.line } : {}),
            message: `${what}. ${guidance[kind] ?? `Resolve the ${kind} issue in ${file}.`}`,
          };
          return [finding];
        }),
      ),
  );
}

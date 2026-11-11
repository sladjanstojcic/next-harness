import { posix } from "node:path";
import { workspaceOf } from "../../config.ts";
import { MAX_FOLDER_FILES } from "../../shapes/limits.ts";
import { TEST_FILE } from "../../shapes/next-modules.ts";
import { classify, readLegacy } from "../classes.ts";
import { checkPath, isVendoredIn, resolveHarness, sourceRootAt, type Harness } from "../path-check.ts";
import { ROOT_FOLDER_GUIDANCE, ROOT_KEBAB_FOLDERS } from "../root-layout.ts";
import type { Finding } from "./finding.ts";
import { listFiles } from "./list-files.ts";

function isRoute(harness: Harness, file: string): boolean {
  const found = workspaceOf(harness.workspaces, file);
  const routeRoot = found?.entry.shapeImpl.routeRoot;
  return routeRoot !== undefined && found !== undefined && found.path.startsWith(routeRoot) && checkPath(file, harness).ok;
}

function folderFindings(harness: Harness, inventory: string[], selected: Set<string>): Finding[] {
  const folders = new Map<string, string[]>();
  for (const file of inventory) {
    if (!/\.(?:tsx?|jsx?|mjs|cjs)$/.test(file) || TEST_FILE.test(file)) continue;
    if (isVendoredIn(harness, file) || isRoute(harness, file)) continue;
    const folder = posix.dirname(file);
    const members = folders.get(folder) ?? [];
    members.push(file);
    folders.set(folder, members);
  }
  const findings: Finding[] = [];
  for (const [folder, members] of folders) {
    const shape = workspaceOf(harness.workspaces, members[0] ?? "")?.entry.shapeImpl;
    const limit = shape?.limits.folderFiles ?? MAX_FOLDER_FILES;
    if (members.length <= limit) continue;
    const destination =
      shape === undefined || ROOT_KEBAB_FOLDERS.some((root) => folder.startsWith(`${root}/`)) ? ROOT_FOLDER_GUIDANCE : shape.folderGuidance(folder);
    for (const file of members.filter((member) => selected.has(member))) {
      findings.push({ rule: "folder-size", file, message: `${folder}/ has ${members.length} source files (maximum ${limit}). ${destination}` });
    }
  }
  return findings;
}

function duplicateFindings(harness: Harness, inventory: string[], selected: Set<string>): Finding[] {
  const names = new Map<string, { file: string; scope: string }[]>();
  for (const file of inventory) {
    const found = workspaceOf(harness.workspaces, file);
    const scope = found?.entry.shapeImpl.sameNameScope(found.path);
    if (found === undefined || scope === undefined) continue;
    const key = `${found.entry.path}/${posix.basename(file)}`;
    const members = names.get(key) ?? [];
    members.push({ file, scope });
    names.set(key, members);
  }
  const findings: Finding[] = [];
  for (const [key, members] of names) {
    const name = posix.basename(key);
    const root = sourceRootAt(harness, members[0]?.file ?? "");
    for (const member of members) {
      if (!selected.has(member.file)) continue;
      const others = members.filter((other) => other.scope !== member.scope);
      if (others.length === 0) continue;
      findings.push({
        rule: "duplicate-file-name",
        file: member.file,
        message: `${name} also exists in ${others.map((other) => other.file).join(", ")}. Move reusable code to ${root}shared/lib/ or ${root}shared/components/, or use module-specific names in ${root}modules/.`,
      });
    }
  }
  return findings;
}

export function auditPaths(root: string, files: string[]): Finding[] {
  const harness = resolveHarness(root);
  const selected = new Set(files);
  const findings: Finding[] = [];
  for (const file of selected) {
    const verdict = checkPath(file, harness);
    if (!verdict.ok) findings.push({ rule: verdict.rule, file, message: verdict.reason });
  }
  // The kit's files are not the project's to move: they count neither towards a folder's size nor as a duplicate name.
  const legacy = readLegacy(root, harness.config);
  const inventory = listFiles(root).filter((file) => classify(file, harness, legacy) !== "upstream");
  return [...findings, ...folderFindings(harness, inventory, selected), ...duplicateFindings(harness, inventory, selected)];
}

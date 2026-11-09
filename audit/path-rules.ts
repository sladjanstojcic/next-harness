import { posix } from "node:path";
import { checkPath, isVendored, MAX_FOLDER_FILES, MODULE_ENTRIES, TEST_FILE } from "../structure.ts";
import type { Finding } from "./finding.ts";
import { listFiles } from "./list-files.ts";

function folderFindings(inventory: string[], selected: Set<string>): Finding[] {
  const folders = new Map<string, string[]>();
  for (const file of inventory) {
    if (!/\.(?:tsx?|jsx?|mjs|cjs)$/.test(file) || TEST_FILE.test(file)) continue;
    if (isVendored(file) || (file.startsWith("src/app/") && checkPath(file).ok)) continue;
    const folder = posix.dirname(file);
    const members = folders.get(folder) ?? [];
    members.push(file);
    folders.set(folder, members);
  }
  const findings: Finding[] = [];
  for (const [folder, members] of folders) {
    if (members.length <= MAX_FOLDER_FILES) continue;
    const destination =
      folder.startsWith("tooling/") || folder.startsWith("scripts/")
        ? "Move cohesive code into a focused subfolder under tooling/ or scripts/."
        : "Use one area subfolder in components/, server/ or domain/, or split feature code into a new src/modules/<module>/; keep actions/, lib/ and hooks/ flat.";
    for (const file of members.filter((member) => selected.has(member))) {
      findings.push({ rule: "folder-size", file, message: `${folder}/ has ${members.length} source files (maximum ${MAX_FOLDER_FILES}). ${destination}` });
    }
  }
  return findings;
}

function duplicateFindings(inventory: string[], selected: Set<string>): Finding[] {
  const names = new Map<string, { file: string; module: string }[]>();
  for (const file of inventory) {
    const parts = file.split("/");
    const moduleName = parts[2];
    const name = posix.basename(file);
    if (parts[0] !== "src" || parts[1] !== "modules" || !moduleName || parts.length < 4 || TEST_FILE.test(file)) continue;
    if (MODULE_ENTRIES.includes(name)) continue;
    const members = names.get(name) ?? [];
    members.push({ file, module: moduleName });
    names.set(name, members);
  }
  const findings: Finding[] = [];
  for (const [name, members] of names) {
    for (const member of members) {
      if (!selected.has(member.file)) continue;
      const others = members.filter((other) => other.module !== member.module);
      if (others.length === 0) continue;
      findings.push({
        rule: "duplicate-file-name",
        file: member.file,
        message: `${name} also exists in ${others.map((other) => other.file).join(", ")}. Move reusable code to src/shared/lib/ or src/shared/components/, or use module-specific names in src/modules/.`,
      });
    }
  }
  return findings;
}

export function auditPaths(root: string, files: string[]): Finding[] {
  const selected = new Set(files);
  const findings: Finding[] = [];
  for (const file of selected) {
    const verdict = checkPath(file);
    if (!verdict.ok) findings.push({ rule: verdict.rule, file, message: verdict.reason });
  }
  const inventory = listFiles(root);
  return [...findings, ...folderFindings(inventory, selected), ...duplicateFindings(inventory, selected)];
}

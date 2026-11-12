import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { usesShadcn } from "../presets/eslint-rules.ts";
import { resolveHarness } from "./path-check.ts";

const dependencyGroup = z.record(z.string(), z.unknown()).optional();
const manifest = z.object({ dependencies: dependencyGroup, devDependencies: dependencyGroup });

function hasFormLibrary(workspaceDir: string): boolean {
  const file = path.join(workspaceDir, "package.json");
  if (!fs.existsSync(file)) return false;
  try {
    const parsed = manifest.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    return parsed.success && [parsed.data.dependencies, parsed.data.devDependencies].some((group) => group?.["react-hook-form"] !== undefined);
  } catch {
    return false;
  }
}

/**
 * How to build the interface in a workspace set up for shadcn (`components.json` at its top), where the shape keeps the
 * generated components in `ui`. The lint rule sees raw controls only; a hand-made layout is held by this text alone.
 */
function interfaceGuidance(workspaceDir: string, ui: string): string[] {
  return [
    "",
    "## Interface",
    "",
    `- Build the interface from the shadcn components in \`${ui}\` and from shadcn's own layouts and blocks (sidebar, page header, cards), unless the task says otherwise. A mockup decides what is on a screen and what it says; shadcn decides how it looks.`,
    "- Do not hand-style a look-alike of a component shadcn has, and keep a component's own variants and spacing.",
    "- If shadcn has no component for something, say so in the handoff before building it by hand.",
    ...(hasFormLibrary(workspaceDir)
      ? ["- A client form uses `react-hook-form` with the shadcn field components and a Zod schema from the module's `schemas.ts`."]
      : []),
    "- If the skills `shadcn` and `vercel-react-best-practices` are available in this session, load them before UI work.",
  ];
}

export function codeIndex(root: string): string {
  const lines = ["# Code index", "", "Reuse these public APIs before adding code. Module internals stay inside their module."];
  for (const workspace of resolveHarness(root).workspaces) {
    if (workspace.path !== "") lines.push("", `# ${workspace.path}`);
    const dir = path.join(root, workspace.path);
    const ui = workspace.shapeImpl.vendored.find((entry) => entry.endsWith("shared/ui/"));
    // First in the workspace, so a long list of exports cannot push it past the 8 KB cut.
    if (ui !== undefined && usesShadcn(dir)) lines.push(...interfaceGuidance(dir, ui));
    lines.push(...workspace.shapeImpl.codeIndex(dir));
  }
  const markdown = `${lines.join("\n")}\n`;
  if (Buffer.byteLength(markdown) <= 8192) return markdown;
  const note = "\n[Code index truncated at 8 KB. Read module public files for the remaining exports.]\n";
  const bytes = Buffer.from(markdown);
  let end = 8192 - Buffer.byteLength(note);
  while (((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8") + note;
}

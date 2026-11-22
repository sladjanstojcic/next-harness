export const SHAPE_NAMES = [
  "next-modules",
  "package",
  "electron-vite",
  "makerkit-app",
  "makerkit-feature",
  "supabase",
  "e2e",
  "vite-spa",
  "pocketbase",
  "node-service",
] as const;
export const TOOL_SET_NAMES = ["eslint-prettier", "oxc", "none"] as const;
export const ANALYSIS_NAMES = ["depcruise", "knip", "jscpd"] as const;

export type ShapeName = (typeof SHAPE_NAMES)[number];
export type ToolSetName = (typeof TOOL_SET_NAMES)[number];
export type AnalysisName = (typeof ANALYSIS_NAMES)[number];

export const DEFAULT_TOOLS: Record<ShapeName, ToolSetName> = {
  "next-modules": "eslint-prettier",
  package: "eslint-prettier",
  "electron-vite": "eslint-prettier",
  "makerkit-app": "oxc",
  "makerkit-feature": "oxc",
  supabase: "none",
  e2e: "eslint-prettier",
  "vite-spa": "eslint-prettier",
  pocketbase: "eslint-prettier",
  "node-service": "eslint-prettier",
};

type ToolsInput = { readonly shape: ShapeName; readonly tools?: ToolSetName };
const ownTools = (workspace: ToolsInput): ToolSetName => workspace.tools ?? DEFAULT_TOOLS[workspace.shape];

/** An e2e workspace without `tools` follows the repository: oxc when another workspace uses oxc, as the Makerkit shapes do. */
export function toolsOf(workspace: ToolsInput, workspaces: readonly ToolsInput[]): ToolSetName {
  if (workspace.tools !== undefined || workspace.shape !== "e2e") return ownTools(workspace);
  return workspaces.some((other) => other.shape !== "e2e" && ownTools(other) === "oxc") ? "oxc" : ownTools(workspace);
}

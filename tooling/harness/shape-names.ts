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

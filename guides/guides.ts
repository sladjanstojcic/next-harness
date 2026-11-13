import fs from "node:fs";
import path from "node:path";
import type { WorkspaceEntry } from "../config.ts";

/** Each guide's line limit: an app's layout needs more room than a package, a database folder or a test folder. */
export const GUIDE_LIMITS: Readonly<Record<string, number>> = {
  common: 45,
  "next-modules": 90,
  "next-modules-root": 90,
  "electron-vite": 90,
  "vite-spa": 90,
  "makerkit-app": 90,
  package: 40,
  "makerkit-feature": 40,
  supabase: 40,
  e2e: 40,
};

/** The guide for a workspace: its shape's, or the layout without src/ for a Next app whose code sits at its top. */
export function guideName(workspace: Pick<WorkspaceEntry, "shape" | "sourceRoot">): string {
  return workspace.shape === "next-modules" && workspace.sourceRoot === "" ? "next-modules-root" : workspace.shape;
}

export function readGuide(name: string): string {
  const file = path.join(import.meta.dirname, `${name}.md`);
  if (!/^[a-z0-9-]+$/.test(name) || !fs.existsSync(file)) throw new Error(`No guide for "${name}"`);
  return fs.readFileSync(file, "utf8").trim();
}

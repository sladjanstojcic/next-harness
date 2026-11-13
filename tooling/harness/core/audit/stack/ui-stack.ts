import fs from "node:fs";
import { join, posix } from "node:path";
import type { ShapeName } from "../../../config.ts";
import { usesShadcn } from "../../../presets/eslint-rules.ts";
import { ELECTRON_LAYOUT } from "../../../shapes/electron/source-rules.ts";
import { VITE_LAYOUT } from "../../../shapes/vite/source-rules.ts";
import { resolveHarness } from "../../path-check.ts";
import type { Finding } from "../finding.ts";

const SITE = "https://sladjanstojcic.github.io/next-harness";
const STACK = "every app is built with TypeScript, Tailwind and shadcn";
const UNLOCK = "they change locked tool configs, so the user unlocks first";

/** The app shapes and the page that holds their setup steps; Makerkit has its own UI package and is not judged. */
const APPS: Partial<Record<ShapeName, { page: string; layout: string }>> = {
  "next-modules": { page: "next-app.html", layout: "" },
  "vite-spa": { page: "vite.html", layout: VITE_LAYOUT },
  "electron-vite": { page: "electron.html", layout: ELECTRON_LAYOUT },
};

const ending = (text: string, layout: string): string => (layout === "" ? `${text}.` : `${text} ${layout}`);

/**
 * The `ui-stack` rule: every app workspace has shadcn's components.json at its top. Without it the shadcn lint rule is
 * off, so a skipped setup would pass every check. Tailwind is not checked: the package.json shows that it is listed,
 * not that it is used, and shadcn cannot be set up without it.
 */
export function auditUiStack(root: string): Finding[] {
  return resolveHarness(root).workspaces.flatMap((workspace): Finding[] => {
    const app = APPS[workspace.shape];
    const file = posix.join(workspace.path, "package.json");
    if (app === undefined || !fs.existsSync(join(root, file))) return [];
    const steps = `${SITE}/${app.page}; ${UNLOCK}`;
    if (usesShadcn(join(root, workspace.path))) return [];
    return [
      {
        rule: "ui-stack",
        file,
        message: ending(`This app has no components.json: ${STACK}. Set shadcn up with the steps on ${steps}`, app.layout),
      },
    ];
  });
}

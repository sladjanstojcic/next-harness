import { makeRepo, type RepoFixture } from "./temp-repo.ts";

const TURBO_LEGACY = "tooling/harness-legacy.json";
/** create-turbo's JavaScript config package, generated before the harness: tolerated as legacy until converted. */
export const TURBO_LEGACY_FILES = ["base.js", "next.js", "react-internal.js"].map((file) => `packages/eslint-config/${file}`);

const TURBO_CONFIG = `export default {
  workspaces: [
    { path: "apps/web", shape: "next-modules", next: true },
    { path: "packages/*", shape: "package" },
  ],
  root: { entries: ["apps", "packages", "turbo.json"] },
  legacy: "${TURBO_LEGACY}",
};
`;

/** create-turbo's own ESLint config for packages/ui, which init keeps. */
export const TURBO_UI_ESLINT = `import { config } from "@repo/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config} */
export default config;
`;

const TSCONFIG = `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: "esnext", moduleResolution: "bundler", jsx: "react-jsx" }, include: ["src"] })}\n`;
const BILLING_PACKAGE = { name: "@repo/billing", type: "module", exports: { ".": "./src/index.ts", "./server": "./src/server.ts" } };

/**
 * create-turbo's output in miniature, the app already under src/: apps/web, the config-only packages eslint-config and
 * typescript-config, packages/ui as generated (components directly in src/) and a billing package in the package layout.
 */
export const TURBO_FILES: Readonly<Record<string, string>> = {
  "harness.config.ts": TURBO_CONFIG,
  ".gitignore": "node_modules/\n.next/\n.turbo/\n",
  "package.json": `${JSON.stringify({ name: "turbo", type: "module", scripts: { build: "turbo run build" } })}\n`,
  "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n  - "packages/*"\n',
  "turbo.json": "{}\n",
  [TURBO_LEGACY]: `${JSON.stringify({ version: 1, files: TURBO_LEGACY_FILES }, null, 2)}\n`,
  "apps/web/package.json": `${JSON.stringify({ name: "web", type: "module" })}\n`,
  "apps/web/tsconfig.json": TSCONFIG,
  "apps/web/src/app/layout.tsx": "export default function Layout() { return null; }\n",
  "apps/web/src/app/page.tsx": "export default function Page() { return null; }\n",
  "packages/eslint-config/package.json": `${JSON.stringify({ name: "@repo/eslint-config", type: "module", exports: { "./base": "./base.js" } })}\n`,
  "packages/eslint-config/README.md": "# `@repo/eslint-config`\n",
  "packages/eslint-config/base.js": "export const config = [];\n",
  "packages/eslint-config/next.js": "export const nextJsConfig = [];\n",
  "packages/eslint-config/react-internal.js": "export const config = [];\n",
  "packages/typescript-config/package.json": `${JSON.stringify({ name: "@repo/typescript-config" })}\n`,
  "packages/typescript-config/base.json": "{}\n",
  "packages/typescript-config/react-library.json": "{}\n",
  "packages/ui/package.json": `${JSON.stringify({ name: "@repo/ui", type: "module", exports: { "./*": "./src/*.tsx" } })}\n`,
  "packages/ui/tsconfig.json": TSCONFIG,
  "packages/ui/eslint.config.mjs": TURBO_UI_ESLINT,
  "packages/ui/src/button.tsx": "export const Button = () => null;\n",
  "packages/ui/src/card.tsx": "export const Card = () => null;\n",
  "packages/billing/package.json": `${JSON.stringify(BILLING_PACKAGE)}\n`,
  "packages/billing/tsconfig.json": TSCONFIG,
  "packages/billing/src/index.ts": "export type Price = { cents: number };\n",
  "packages/billing/src/server.ts": 'import "server-only";\n\nexport function getPrices(): number[] {\n  return [];\n}\n',
};

/** The miniature with tool binaries that exist but never run; tests stub the tool runner. */
export function turboRepo(files: Record<string, string> = {}): RepoFixture {
  const bins = Object.fromEntries(
    ["eslint", "prettier", "tsc", "vitest", "depcruise", "knip", "jscpd"].map((tool): [string, string] => [`node_modules/.bin/${tool}`, ""]),
  );
  return makeRepo({ ...TURBO_FILES, ...bins, "apps/web/node_modules/.bin/next": "", ...files });
}

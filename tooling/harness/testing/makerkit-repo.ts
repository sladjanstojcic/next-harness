import { makeRepo, type RepoFixture } from "./temp-repo.ts";

export const MAKERKIT_ROUTE = "apps/web/app/[locale]/home/[account]/journal";
export const MAKERKIT_KIT_ROUTE = "apps/web/app/[locale]/home/[account]/billing";

export function makerkitConfig(owned: readonly string[] = [`${MAKERKIT_ROUTE}/`, "packages/features/journal/", "apps/web/supabase/"]): string {
  return `export default {
  workspaces: [{ path: "apps/web", shape: "makerkit-app", next: true }],
  owned: ${JSON.stringify(owned)},
  root: { entries: ["apps", "packages"] },
};
`;
}

const ACTION = `"use server";
import { authActionClient } from "@kit/next/safe-action";
import { BillingSchema } from "../schema/team-billing.schema";
export const createCheckout = authActionClient.inputSchema(BillingSchema).action(async () => ({ ok: true }));
`;

/** oxy-app's layout in miniature: apps/web as a Makerkit app, kit packages beside it, committed env files and .mjs configs. */
export function makerkitRepo(files: Record<string, string> = {}): RepoFixture {
  return makeRepo({
    "harness.config.ts": makerkitConfig(),
    "package.json": "{}\n",
    "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/**\n",
    "apps/web/package.json": "{}\n",
    "apps/web/tsconfig.json": "{}\n",
    "apps/web/.env": "NEXT_PUBLIC_PRODUCT_NAME=Oxy\n",
    "apps/web/.env.development": "NEXT_PUBLIC_SITE_URL=http://localhost:3000\n",
    "apps/web/next.config.mjs": "export default {};\n",
    "apps/web/postcss.config.mjs": "export default {};\n",
    "apps/web/proxy.ts": "export const config = { matcher: [] };\n",
    "apps/web/app/[locale]/layout.tsx": "export default function Layout() { return null; }\n",
    "apps/web/app/api/healthcheck/route.ts": "export const GET = () => new Response();\n",
    [`${MAKERKIT_KIT_ROUTE}/page.tsx`]: "export default function Page() { return null; }\n",
    [`${MAKERKIT_KIT_ROUTE}/_lib/server/server-actions.ts`]: ACTION,
    [`${MAKERKIT_KIT_ROUTE}/_lib/schema/team-billing.schema.ts`]: "export const BillingSchema = {};\n",
    "apps/web/config/app.config.ts": "const appConfig = { name: process.env.NEXT_PUBLIC_PRODUCT_NAME };\nexport default appConfig;\n",
    "apps/web/config/paths.config.ts": "export const pathsConfig = {};\n",
    "apps/web/lib/server/require-user-in-server-component.ts": 'import "server-only";\nexport const requireUser = () => null;\n',
    "apps/web/i18n/request.ts": "export default {};\n",
    "apps/web/i18n/messages/en/common.json": "{}\n",
    "apps/web/styles/globals.css": "\n",
    "apps/web/content/posts/hello.mdoc": "# Hello\n",
    "apps/web/supabase/config.toml": "\n",
    "packages/features/accounts/package.json": "{}\n",
    "packages/ui/src/shadcn/button.tsx": "export const Button = () => null;\n",
    ...files,
  });
}

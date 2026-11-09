const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);
const lines = (text: string): string[] => text.split("\n").filter(Boolean);

export const PATHS = words(String.raw`
  src/utils/x.ts src/modules/orders/helpers/x.ts lib/x.ts src/modules/orders/components/OrderRow.tsx src/modules/orders/components/table/cells/x.tsx
  src/modules/orders/server/pricing/deep/x.ts src/modules/orders/server/utils/x.ts src/modules/orders/server/Helpers/x.ts src/modules/orders/domain/helpers/total.ts
  src/modules/orders/components/common/x.tsx src/shared/components/misc/x.tsx src/app/orders/order-row.tsx src/shared/lib/x.js src/.secret.ts src/shared/lib/x.mjs
  src/shared/lib/x.cjs src/shared/components/x.jsx src/shared/ui/x.js src/modules/orders/domain/.secret.ts src/modules/orders/other.ts
  src/modules/orders/actions/create-order.ts src/modules/orders/actions/foo.test.ts src/modules/orders/actions/create-order-action.tsx
  src/modules/orders/actions/sub/create-order-action.ts src/modules/orders/domain/pricing/rules/total.ts src/shared/utils/x.ts src/shared/lib/sub/x.ts
  src/shared/hooks/sub/use-x.ts src/shared/components/table/cells/x.tsx src/modules/Orders/index.ts src/shared/components/BadFolder/x.tsx tooling/harness/bad_name.ts
  src/modules/orders/components/[id]/x.tsx src/app/page.ts src/app/route.tsx src/app/orders/globals.css src/app/_private/page.tsx postcss.config.ts
  package.json/nested.ts scripts/RenameProject.ts e2e/SmokeTest.ts vercel.json Dockerfile .vscode/settings.json .github/check.js
  src/modules/orders/components/table/order-row.tsx src/modules/orders/actions/create-order-action.ts src/modules/orders/server/get-orders.ts
  src/modules/orders/server/documents/get-invoice-pdf.ts src/modules/orders/server/documents/get-invoice-pdf.test.ts src/modules/orders/domain/pricing/total.ts
  src/modules/orders/domain/pricing/total.test.ts src/modules/.gitkeep src/instrumentation-client.ts README.md .gitignore next.config.ts
  src/modules/orders/domain/total.test.ts src/app/(shop)/orders/[id]/page.tsx src/app/global-error.tsx src/shared/ui/sidebar.tsx src/proxy.ts tooling/harness/cli.ts
  .github/workflows/check.yml src/modules/orders/index.test.ts src/modules/orders/actions/create-order-action.test.ts src/modules/orders/actions/create-order-action.test.tsx
  src/modules/orders/server.test.ts src/modules/orders/schemas.test.ts src/modules/orders/types.test.ts src/modules/orders/index.ts src/modules/orders/server.ts
  src/modules/orders/schemas.ts src/modules/orders/types.ts src/shared/components/table/table-header.tsx src/shared/lib/format.test.ts src/shared/hooks/use-mobile.ts
  src/shared/ui/deep/nested/button.tsx src/instrumentation.ts src/app/[...slug]/page.tsx src/app/[[...slug]]/page.tsx src/app/@modal/default.tsx
  src/app/@modal/(.)photo/[id]/page.tsx src/app/@modal/(..)photo/page.tsx src/app/@modal/(..)(..)x/page.tsx src/app/@modal/(...)photo/page.tsx src/app/layout.tsx
  src/app/loading.tsx src/app/error.tsx src/app/not-found.tsx src/app/template.tsx src/app/forbidden.tsx src/app/unauthorized.tsx src/app/global-not-found.tsx
  src/app/api/orders/route.ts src/app/globals.css src/app/favicon.ico src/app/icon.svg src/app/icon1.png src/app/apple-icon2.png src/app/icon.tsx src/app/apple-icon.ts
  src/app/opengraph-image.png src/app/twitter-image.tsx src/app/sitemap.ts src/app/sitemap.xml src/app/robots.ts src/app/robots.txt src/app/manifest.ts
  src/app/manifest.json src/app/manifest.webmanifest next-env.d.ts docs/README.md .env.example .githooks/pre-push .claude/settings.json .codex/hooks.json
  .dependency-cruiser.json .jscpd.json e2e/smoke.spec.ts scripts/rename.ts public/logo.svg .claude/skills/review/SKILL.md .codex/skills/review/SKILL.md
  .github/PULL_REQUEST_TEMPLATE.md .github/ISSUE_TEMPLATE/ .github/ISSUE_TEMPLATE/Bug_Report.md .github/CODEOWNERS public/.well-known/security.txt
  public/fonts/Inter-Bold.woff2 docs/ADR-0001.md .mcp.json .npmrc .nvmrc .node-version .editorconfig .gitattributes LICENSE CHANGELOG.md
  .env .env.local src/modules/a/.env.production pnpm-lock.yaml src/shared/ui/button.tsx src/shared/lib/utils.ts package.json src/shared/components/x.tsx
  src/modules/a/server/get-a.ts .next/x /tmp/x tooling/harness/structure.ts src/modules/orders/index.ts
  src/app/(group)/page.tsx src/app/(.)x/page.tsx src/app/x/(.)y/z.tsx src/app/x/[id]/OrderRow.tsx src/app/x/[id]/[[...rest]]/page.tsx src/app/x/layout.ts
  src/app/x/route.ts src/app/default.tsx src/app/apple-icon.png src/app/opengraph-image.alt.txt src/app/sitemap.json src/app/.gitkeep src/.gitkeep
  src/shared/.gitkeep src/modules/orders/.gitkeep src/x.ts src/middleware.ts src/proxy.tsx src pnpm-workspace.yaml components.json eslint.config.ts
  prettier.config.ts knip.config.ts vitest.config.ts playwright.config.ts tsconfig.json .prettierignore CLAUDE.md AGENTS.md README.md/x tooling
  tooling/harness/x.js tooling/Harness/x.ts tooling/harness/hooks/fixtures/claude/stop.json scripts/x.mjs e2e/Bad/x.ts docs/Bad_Name.md public/BadName.png
  src/modules/orders/server/x.js src/modules/a-b/index.ts src/modules/a_b/index.ts src/shared/ui/.hidden src/shared/lib/.env
  src/modules/orders/components/core/x.tsx src/modules/orders/domain/lib/x.ts src/shared/components/stuff/x.tsx src/modules/orders/actions/x-action.test.ts
  src/modules/orders/schemas.tsx src/modules/orders/index.tsx src/shared/hooks/use-x.tsx src/modules/orders/server/documents/deep/x.ts
`);

const RAW_COMMANDS = lines(String.raw`prisma migrate reset
pnpm exec prisma migrate dev
prisma db execute
prisma db pull
prisma db push --force-reset
prisma db push --accept-data-loss
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 prisma db push
supabase db reset --linked
supabase db reset --project-ref abc
git push --force
git push --force-if-includes
git push origin +main
git -C somewhere push --force
git -C "path with spaces" push --force-with-lease
git push -uf origin main
git push -fu origin main
find . -delete
find . -exec rm -rf {} +
git push -f
git push --force-with-lease
rm -rf ../x
/bin/rm -rf ~/x
find .. -delete
find /tmp -exec rm {} \;
rm -rf .git
rm -rf .
rm -rf "$HOME/x"
git status && rm -rf ../x
pnpm harness:unlock
node tooling/harness/cli.ts unlock
pnpm harness:blocks --false 1a2b3c "generated page"
prisma generate
prisma db push
supabase db reset
supabase start
git push
git push origin main
git -C somewhere push -u origin main
find . -iname cache -delete
find . -path ./cache -delete
rm -rf src/x
find src -name x
find src -delete
find . -name x -delete
find src -exec rm {} \;
pnpm dlx shadcn add button
cat .env.example
git diff
rm -rf ..cache
git push -f; supabase db reset --linked; prisma migrate reset; rm ..
git push -f; supabase db reset --linked; rm ..
rm ..; git push -f
pnpm harness:blocks
node tooling/harness/cli.ts blocks
node tooling/harness/cli.ts blocks --false 1a2b3c
pnpm install
supabase db push
supabase link
pnpm supabase:deploy
`);

export const COMMANDS = [...RAW_COMMANDS, 'rm -rf "${HOME}/x"'];

const numbered = (count: number, line: (index: number) => string): string => Array.from({ length: count }, (_, index) => line(index)).join("\n") + "\n";
const largeFunction = (name: string): string =>
  `export function ${name}(value: number): number {\n  const doubled = value * 2;\n  const increased = doubled + 1;\n  if (increased > 10) return increased - 3;\n  return increased + doubled + value + 1;\n}\n`;

export const GATE_SEEDS: Record<string, string> = {
  "src/modules/orders/components/big-list.tsx": numbered(251, (index) => `export const row${String(index)} = ${String(index)};`),
  "src/utils/x.ts": "export const x = 1;\n",
  "src/app/orders/page.tsx": `export default function Page() {\n  return (\n    <main>\n${numbered(55, (index) => `      <p>${String(index)}</p>`)}    </main>\n  );\n}\n`,
  "src/modules/orders/components/env-banner.tsx": "export function EnvBanner() {\n  return <p>{process.env.NEXT_PUBLIC_NAME}</p>;\n}\n",
  "src/modules/orders/actions/create-order-action.ts": '"use server";\n\nexport async function createOrder(): Promise<void> {}\n',
  "src/modules/orders/domain/total.ts": "export function total(values: number[]): number {\n  return values.reduce((sum, value) => sum + value, 0);\n}\n",
  "src/modules/orders/domain/total.test.ts": "export const stamp = Date.now();\n",
  "src/modules/orders/domain/tax.ts": "export function tax(value: number): number {\n  return value * 0.2;\n}\n",
  "src/modules/orders/server/get-orders.ts": "export const orders: string[] = [];\n",
  "src/modules/billing/server/get-orders.ts": 'import "server-only";\n\nexport const invoices: number[] = [];\n',
  "src/shared/lib/x.ts": '"use client";\n\nexport const shared = 1;\n',
  "src/modules/orders/components/row.tsx":
    '"use client";\n\nimport { orders } from "../server/get-orders.ts";\n\nexport function Row() {\n  return <p>{orders.length}</p>;\n}\n',
  "src/modules/orders/index.ts": 'export { orders } from "./server.ts";\n',
  "src/modules/orders/components/view.tsx": "export function View({ error }: { error: Error }) {\n  return <p>{error.message}</p>;\n}\n",
  "src/modules/orders/domain/sum.ts": largeFunction("sum"),
  "src/modules/orders/domain/sum.test.ts": "export {};\n",
  "src/modules/billing/domain/add.ts": largeFunction("add"),
  "src/modules/billing/domain/add.test.ts": "export {};\n",
  ...Object.fromEntries(
    Array.from({ length: 11 }, (_, index) => [
      `src/modules/orders/server/get-part-${String(index)}.ts`,
      `import "server-only";\n\nexport const part${String(index)} = ${String(index)};\n`,
    ]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 11 }, (_, index) => [`scripts/jobs/job-${String(index)}.ts`, `export const job${String(index)} = ${String(index)};\n`]),
  ),
};

export const PRE_EXISTING_SEEDS: Record<string, string> = { "src/utils/y.ts": "export const y = 1;\n" };

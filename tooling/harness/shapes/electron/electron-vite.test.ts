import { describe, expect, it } from "vitest";
import { codeIndex } from "../../core/code-index.ts";
import { isLocked } from "../../core/lock.ts";
import { checkPath, isVendoredIn, resolveHarness } from "../../core/path-check.ts";
import { loadConfig } from "../../config.ts";
import { ELECTRON_CONFIG } from "../../testing/electron-repo.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { ELECTRON_PROBES, electronVite } from "./electron-vite.ts";

const LAYOUT = "(Electron layout)";
const R = "src/renderer/src";
const atRoot = () => resolveHarness(makeRepo({ "harness.config.ts": ELECTRON_CONFIG }).root);
const nested = () =>
  makeRepo({
    "harness.config.ts": 'export default { workspaces: [{ path: "apps/*", shape: "electron-vite" }], root: { entries: ["apps"] } };\n',
    "apps/desk/package.json": "{}\n",
  });

describe("electron-vite paths", () => {
  it.each([
    "electron.vite.config.ts",
    "electron-builder.yml",
    "components.json",
    "tsconfig.json",
    "tsconfig.base.json",
    "tsconfig.node.json",
    "tsconfig.web.json",
    "eslint.config.ts",
    "eslint.config.mjs",
    ".prettierrc.yaml",
    "vitest.config.ts",
    "build/icon.icns",
    "build/entitlements.mac.plist",
    "resources/icon.png",
    "e2e/smoke.test.ts",
    "src/main/index.ts",
    "src/main/index.test.ts",
    "src/main/storage/client.ts",
    "src/main/storage/client.test.ts",
    "src/main/db/schema.ts",
    "src/main/.gitkeep",
    "src/preload/index.ts",
    "src/preload/index.d.ts",
    "src/preload/api.ts",
    "src/renderer/index.html",
    `${R}/main.tsx`,
    `${R}/app.tsx`,
    `${R}/app.test.tsx`,
    `${R}/env.d.ts`,
    `${R}/styles.css`,
    `${R}/assets/logo.svg`,
    `${R}/assets/fonts/Inter-Regular.woff2`,
    `${R}/assets/main.css`,
    `${R}/modules/notes/index.ts`,
    `${R}/modules/notes/types.ts`,
    `${R}/modules/notes/schemas.ts`,
    `${R}/modules/notes/components/note-form.tsx`,
    `${R}/modules/notes/components/lines/line-row.tsx`,
    `${R}/modules/notes/domain/total.ts`,
    `${R}/modules/notes/domain/total.test.ts`,
    `${R}/modules/notes/domain/tax/split.ts`,
    `${R}/modules/notes/hooks/use-note.ts`,
    `${R}/shared/ui/button.tsx`,
    `${R}/shared/components/page-header.tsx`,
    `${R}/shared/components/forms/field.tsx`,
    `${R}/shared/lib/utils.ts`,
    `${R}/shared/hooks/use-online.ts`,
    "src/shared/note.ts",
    "src/shared/ipc.test.ts",
    "src/shared/storage/status.ts",
  ])("accepts %s", (file) => {
    expect(checkPath(file, atRoot())).toEqual({ ok: true });
  });

  it.each([
    [`${R}/utils/x.ts`, "src-shape", "modules/<module>/"],
    ["src/main/helpers/x.ts", "generic-folder", "after its area"],
    ["src/lib/x.ts", "src-shape", "src/ takes main/, preload/, renderer/ and shared/"],
    ["src/app/page.tsx", "src-shape", "src/ takes main/, preload/, renderer/ and shared/"],
    ["src/x.ts", "src-shape", "src/ takes main/"],
    ["src/main/window.ts", "src-shape", "src/main/ takes index.ts, the entry"],
    ["src/main/storage/http/client.ts", "nesting", "one level of area folders"],
    ["src/main/storage/panel.tsx", "file-name", "Keep src/main/ for TypeScript (.ts)"],
    ["src/preload/api/notes.ts", "nesting", "Keep src/preload/ flat"],
    ["src/renderer/src/App.tsx", "file-name", "kebab-case"],
    [`${R}/components/versions.tsx`, "src-shape", "modules/<module>/"],
    [`${R}/versions.tsx`, "src-shape", "takes main.tsx, app.tsx, env.d.ts and CSS files"],
    [`${R}/assets/icons.ts`, "src-shape", "assets/ holds images, fonts and CSS"],
    ["src/renderer/preload.ts", "src-shape", "src/renderer/ takes index.html and src/"],
    [`${R}/modules/notes/server.ts`, "module-shape", "no server.ts, server/ or actions/"],
    [`${R}/modules/notes/server/get-notes.ts`, "module-shape", "no server.ts, server/ or actions/"],
    [`${R}/modules/notes/actions/save-note-action.ts`, "module-shape", "no server.ts, server/ or actions/"],
    [`${R}/modules/notes/utils/x.ts`, "module-shape", "components/, domain/ or hooks/"],
    [`${R}/modules/notes/components/helpers/x.tsx`, "generic-folder", "after its area"],
    [`${R}/modules/notes/domain/total.tsx`, "file-name", "pure TypeScript (.ts)"],
    [`${R}/modules/notes/hooks/note.ts`, "file-name", "use-<name>.ts(x)"],
    [`${R}/modules/notes/hooks/forms/use-note.ts`, "nesting", "Keep hooks/ flat"],
    [`${R}/shared/utils/x.ts`, "shared-shape", "shared/components/, lib/ or hooks/"],
    [`${R}/shared/lib/dates/format.ts`, "nesting", "shared/lib/ and hooks/ flat"],
    ["src/shared/common/x.ts", "generic-folder", "after its area"],
    ["src/shared/storage/status/codes.ts", "nesting", "one level of area folders"],
    ["src/shared/badge.tsx", "file-name", "Keep src/shared/ for TypeScript (.ts)"],
    ["src/main/Storage/client.ts", "file-name", "kebab-case"],
    ["e2e/Smoke.test.ts", "file-name", "kebab-case"],
    ["src/main/.env", "hidden-file", "only .gitkeep may be hidden"],
    ["x.js", "unknown-root", "Use an approved entry"],
    ["electron.vite.config.js", "unknown-root", "Use an approved entry"],
    ["build/notarize.js", "js-file", "Use TypeScript"],
    ["vercel.json", "unknown-root", "Use an approved entry"],
    ["tooling/Bad.ts", "file-name", "kebab-case"],
  ])("denies %s as %s", (file, rule, advice) => {
    const verdict = checkPath(file, atRoot());
    expect(verdict).toMatchObject({ ok: false, rule });
    const reason = verdict.ok ? "" : verdict.reason;
    expect(reason).toContain(advice);
    expect(reason.endsWith(LAYOUT)).toBe(true);
  });

  it("lets every probe path through, so the preset check judges only paths the shape allows", () => {
    const harness = atRoot();
    for (const probe of ELECTRON_PROBES) expect(checkPath(probe.replaceAll("{name}", "a-1"), harness), probe).toEqual({ ok: true });
  });

  it("applies under a workspace folder, where the app keeps its own README and .gitignore", () => {
    const harness = resolveHarness(nested().root);
    for (const file of ["apps/desk/src/main/index.ts", "apps/desk/README.md", "apps/desk/.gitignore", "apps/desk/tsconfig.web.json"]) {
      expect(checkPath(file, harness), file).toEqual({ ok: true });
    }
    expect(checkPath("apps/desk/src/lib/x.ts", harness)).toMatchObject({ ok: false, rule: "src-shape" });
    expect(checkPath("apps/desk/lib/x.ts", harness)).toMatchObject({ ok: false, rule: "unknown-root" });
  });

  it("treats the generated shadcn code as vendored and scopes duplicate names to renderer modules", () => {
    const harness = atRoot();
    expect(isVendoredIn(harness, `${R}/shared/ui/button.tsx`)).toBe(true);
    expect(isVendoredIn(harness, `${R}/shared/lib/utils.ts`)).toBe(true);
    expect(isVendoredIn(harness, `${R}/shared/lib/money.ts`)).toBe(false);
    expect(electronVite.sameNameScope(`${R}/modules/notes/domain/total.ts`)).toBe("notes");
    expect(electronVite.sameNameScope(`${R}/modules/notes/index.ts`)).toBeUndefined();
    expect(electronVite.sameNameScope(`${R}/modules/notes/domain/total.test.ts`)).toBeUndefined();
    expect(electronVite.sameNameScope("src/main/storage/total.ts")).toBeUndefined();
  });
});

describe("the lock in an electron-vite workspace", () => {
  it.each([
    "electron.vite.config.ts",
    "electron-builder.yml",
    "tsconfig.json",
    "tsconfig.base.json",
    "tsconfig.node.json",
    "tsconfig.web.json",
    "eslint.config.ts",
  ])("covers %s at the root", (file) => {
    const repo = makeRepo({ "harness.config.ts": ELECTRON_CONFIG });
    expect(isLocked(file, loadConfig(repo.root), repo.root)).toBe(true);
  });

  it("leaves source and packaging files open, and the same names in a repository without the shape", () => {
    const repo = makeRepo({ "harness.config.ts": ELECTRON_CONFIG });
    const config = loadConfig(repo.root);
    for (const file of ["src/main/index.ts", "components.json", "build/icon.png", "src/main/tsconfig.json.ts"])
      expect(isLocked(file, config, repo.root), file).toBe(false);
    const plain = makeRepo();
    for (const file of ["electron.vite.config.ts", "tsconfig.node.json"]) expect(isLocked(file, loadConfig(plain.root), plain.root), file).toBe(false);
  });

  it("opens a new workspace's configs until a commit holds a file of it", () => {
    const repo = nested();
    const config = loadConfig(repo.root);
    const configs = (app: string): string[] => [`apps/${app}/electron.vite.config.ts`, `apps/${app}/tsconfig.node.json`];
    for (const file of configs("desk")) expect(isLocked(file, config, repo.root), file).toBe(true);
    for (const file of configs("pos")) expect(isLocked(file, config, repo.root), file).toBe(false);
    repo.write("apps/pos/package.json", "{}\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "Add pos");
    for (const file of configs("pos")) expect(isLocked(file, config, repo.root), file).toBe(true);
  });
});

describe("the code index of an electron-vite workspace", () => {
  it("lists the contract, each renderer module's index.ts and the renderer's shared/lib", () => {
    const repo = makeRepo({
      "harness.config.ts": ELECTRON_CONFIG,
      "src/shared/ipc.ts": 'export const IPC = { appInfo: "app:info" } as const;\nexport interface AppInfo {\n  name: string;\n}\n',
      "src/shared/ipc.test.ts": "export const ignored = 1;\n",
      "src/shared/storage/status.ts": "export type Status = { ok: boolean };\n",
      [`${R}/modules/notes/index.ts`]: 'export { NoteForm } from "./components/note-form";\n',
      [`${R}/modules/notes/domain/total.ts`]: "export const total = 1;\n",
      [`${R}/shared/lib/money.ts`]: "export const formatMoney = (value: number): string => String(value);\n",
      "src/main/index.ts": "export const hidden = 1;\n",
    });
    const index = codeIndex(repo.root);
    expect(index).toContain("## src/shared (the contract between main, preload and renderer)\n\n- `ipc.ts`: `IPC`, `AppInfo`\n- `storage/status.ts`: `Status`");
    expect(index).toContain("## notes\n\n- `index.ts`: `NoteForm`");
    expect(index).toContain("## renderer shared/lib\n\n- `money.ts`: `formatMoney`");
    expect(index).not.toContain("hidden");
    expect(index).not.toContain("ignored");
    expect(index).not.toContain("total");
  });
});

import { describe, expect, it } from "vitest";
import { auditSource } from "../../core/audit/content-rules.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { electronContent } from "./content.ts";

const R = "src/renderer/src";
const root = makeRepo().root;
const found = (file: string, source: string) => auditSource(root, { file, path: file, profile: electronContent, pageLines: Number.POSITIVE_INFINITY }, source);
const rules = (file: string, source: string): string[] => found(file, source).map(({ rule, line }) => `${rule}:${String(line)}`);

describe("electron-security", () => {
  const window = (options: string): string => `import { BrowserWindow } from "electron";\n\nnew BrowserWindow({\n  webPreferences: { ${options} },\n});\n`;

  it.each(["nodeIntegration: true", "contextIsolation: false", "sandbox: false", "webSecurity: false", '"sandbox": false'])(
    "reports %s in src/main/",
    (option) => {
      const findings = found("src/main/index.ts", window(option));
      expect(findings.map(({ rule, line }) => `${rule}:${String(line)}`)).toEqual(["electron-security:4"]);
      expect(findings[0]?.message).toContain(option.replaceAll('"', ""));
      expect(findings[0]?.message.endsWith("(Electron layout)")).toBe(true);
    },
  );

  it("passes the safe values, a value that is not a literal, and the same option outside src/main/", () => {
    expect(rules("src/main/window/create.ts", window("contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true"))).toEqual([]);
    expect(rules("src/main/window/create.ts", window("sandbox: isSandboxed"))).toEqual([]);
  });
});

describe("electron-security, the other spellings", () => {
  it("reports an assignment to the option, by name or by string key", () => {
    expect(rules("src/main/window/create.ts", "prefs.sandbox = false;\n")).toEqual(["electron-security:1"]);
    expect(rules("src/main/window/create.ts", 'prefs["nodeIntegration"] = true;\n')).toEqual(["electron-security:1"]);
    expect(rules("src/main/window/create.ts", "prefs.sandbox = true;\nconst sandbox = false;\n")).toEqual([]);
  });

  it("reads src/shared/ too, where window defaults can sit, and no test file", () => {
    expect(rules("src/shared/window.ts", "export const WINDOW_DEFAULTS = { sandbox: false };\n")).toEqual(["electron-security:1"]);
    expect(rules("src/main/window/create.test.ts", "expect(options).not.toEqual({ sandbox: false });\n")).toEqual([]);
    expect(rules("src/preload/index.ts", "export const options = { sandbox: false };\n")).toEqual([]);
  });

  it("does not follow a shorthand property, and reports the key in another library's options: two documented limits", () => {
    expect(rules("src/main/window/create.ts", "const sandbox = false;\nnew BrowserWindow({ webPreferences: { sandbox } });\n")).toEqual([]);
    expect(rules("src/main/print/pdf.ts", "await launch({ sandbox: false });\n")).toEqual(["electron-security:1"]);
  });
});

describe("electron-security, <webview> and the remote module", () => {
  it("reports webviewTag: true and enableRemoteModule: true beside the other window options", () => {
    expect(rules("src/main/window/create.ts", "export const prefs = { webviewTag: true, enableRemoteModule: true };\n")).toEqual([
      "electron-security:1",
      "electron-security:1",
    ]);
    expect(rules("src/main/window/create.ts", 'prefs.webviewTag = true;\nprefs["enableRemoteModule"] = true;\n')).toEqual([
      "electron-security:1",
      "electron-security:2",
    ]);
    expect(rules("src/main/window/create.ts", "export const prefs = { webviewTag: false, enableRemoteModule: false };\n")).toEqual([]);
    expect(rules("src/main/window/create.test.ts", "expect(prefs).not.toEqual({ webviewTag: true });\n")).toEqual([]);
  });

  it("reports a <webview> element in the renderer, with or without children", () => {
    const file = `${R}/modules/notes/components/preview.tsx`;
    const findings = found(file, 'export const Preview = () => <webview src="https://example.com" />;\n');
    expect(findings.map(({ rule, line }) => `${rule}:${String(line)}`)).toEqual(["electron-security:1"]);
    expect(findings[0]?.message).toContain("<webview>");
    expect(rules(file, "export const Preview = () => (\n  <webview>\n    <p />\n  </webview>\n);\n")).toEqual(["electron-security:2"]);
    expect(rules(file, "export const Preview = () => <Webview />;\n")).toEqual([]);
  });

  it("reports an import of @electron/remote anywhere, also a subpath and a dynamic import", () => {
    expect(rules("src/main/index.ts", 'import { initialize } from "@electron/remote/main";\n')).toEqual(["electron-security:1"]);
    expect(rules(`${R}/app.tsx`, 'import remote from "@electron/remote";\n')).toEqual(["electron-security:1"]);
    expect(rules("scripts/seed.ts", 'const remote = await import("@electron/remote");\n')).toEqual(["electron-security:1"]);
    expect(rules("src/main/index.ts", 'import { remote } from "@electron/remote-control";\n')).toEqual([]);
  });
});

describe("electron-security, shell.openExternal", () => {
  const shell = 'import { shell } from "electron";\n\n';

  it.each(["shell.openExternal(details.url)", "void shell.openExternal(url)", "electron.shell.openExternal(`https://${host}`)", "shell.openExternal(HOME)"])(
    "reports %s, an address the call did not write",
    (call) => {
      const findings = found("src/main/index.ts", `${shell}${call};\n`);
      expect(findings.map(({ rule, line }) => `${rule}:${String(line)}`)).toEqual(["electron-security:3"]);
      expect(findings[0]?.message).toContain("open-external.ts in a src/main/ area folder (src/main/links/open-external.ts)");
    },
  );

  it("reports openExternal destructured from shell, under its local name", () => {
    expect(rules("src/main/index.ts", `${shell}const { openExternal } = shell;\nvoid openExternal(url);\n`)).toEqual(["electron-security:4"]);
    expect(rules("src/main/index.ts", `${shell}const { openExternal: open } = shell;\nvoid open(url);\n`)).toEqual(["electron-security:4"]);
    expect(rules("src/main/index.ts", 'import { openExternal } from "./links/open-external";\n\nvoid openExternal(url);\n')).toEqual([]);
  });

  it("passes a string literal anywhere in src/main/, and any address in the one file that checks it", () => {
    expect(rules("src/main/index.ts", `${shell}void shell.openExternal("https://example.com/help");\n`)).toEqual([]);
    expect(rules("src/main/menu/help.ts", `${shell}void shell.openExternal(\`https://example.com/help\`);\n`)).toEqual([]);
    expect(rules("src/main/links/open-external.ts", `${shell}export const open = (url: string) => shell.openExternal(url);\n`)).toEqual([]);
    expect(rules("src/main/open-external.ts", `${shell}void shell.openExternal(url);\n`)).toEqual(["electron-security:3"]);
    expect(rules("src/main/links/open-external.test.ts", `${shell}void shell.openExternal(url);\n`)).toEqual([]);
  });

  it("does not follow an alias of the function: a documented limit", () => {
    expect(rules("src/main/index.ts", `${shell}const open = shell.openExternal;\nvoid open(url);\n`)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { auditSource } from "../../core/audit/content-rules.ts";
import { HARNESS_RULES } from "../../core/classes.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { electronContent } from "./content.ts";

const R = "src/renderer/src";
const root = makeRepo().root;
const found = (file: string, source: string) => auditSource(root, { file, path: file, profile: electronContent, pageLines: Number.POSITIVE_INFINITY }, source);
const rules = (file: string, source: string): string[] => found(file, source).map(({ rule, line }) => `${rule}:${String(line)}`);

describe("electron-bridge", () => {
  it("reports ipcRenderer and contextBridge outside src/preload/, once per file", () => {
    expect(rules(`${R}/app.tsx`, 'import { ipcRenderer } from "electron";\n\nexport const ping = () => ipcRenderer.send(channel);\n')).toEqual([
      "electron-bridge:1",
    ]);
    expect(rules(`${R}/app.tsx`, "export const ping = (): void => window.electron.ipcRenderer.send(channel);\n")).toEqual(["electron-bridge:1"]);
    expect(rules("src/main/index.ts", 'import { contextBridge } from "electron";\n\ncontextBridge.exposeInMainWorld("api", {});\n')).toEqual([
      "electron-bridge:1",
    ]);
    expect(rules("src/shared/api.ts", "export interface Api {\n  ipcRenderer: unknown;\n}\n")).toEqual(["electron-bridge:2"]);
  });

  it("passes them in src/preload/, and ipcMain in src/main/", () => {
    const preload =
      'import { contextBridge, ipcRenderer } from "electron";\n\ncontextBridge.exposeInMainWorld("api", { ping: () => ipcRenderer.invoke(IPC.ping) });\n';
    expect(rules("src/preload/index.ts", preload)).toEqual([]);
    expect(rules("src/main/index.ts", 'import { ipcMain } from "electron";\n\nipcMain.handle(IPC.ping, () => 1);\n')).toEqual([]);
    expect(rules("electron.vite.config.ts", "export const ipcRenderer = 1;\n")).toEqual([]);
  });
});

describe("ipc-channel", () => {
  it.each([
    ["src/main/index.ts", 'ipcMain.handle("app:info", () => 1);'],
    ["src/main/index.ts", "ipcMain.on('ping', () => undefined);"],
    ["src/main/ipc/register.ts", "ipcMain.once(`ready`, () => undefined);"],
    ["src/preload/index.ts", 'void ipcRenderer.invoke("app:info");'],
    ["src/preload/index.ts", 'ipcRenderer.send("ping");'],
    ["src/preload/index.ts", 'ipcRenderer.on("progress", () => undefined);'],
    ["src/preload/index.ts", 'electron.ipcRenderer.send("ping");'],
  ])("reports a literal channel in %s: %s", (file, call) => {
    expect(rules(file, `${call}\n`)).toEqual(["ipc-channel:1"]);
  });

  it.each([
    ["src/main/ipc/register.ts", 'ipcMain.handleOnce("ready", () => 1);'],
    ["src/preload/index.ts", 'ipcRenderer.sendSync("notes:count");'],
    ["src/preload/index.ts", 'ipcRenderer.once("notes:changed", () => undefined);'],
    ["src/main/notes/store.ts", 'window.webContents.send("notes:changed", notes);'],
    ["src/main/notes/store.ts", 'event.sender.webContents.send("notes:changed");'],
    ["src/main/ipc/register.ts", "ipcMain.handle(`notes:${kind}`, () => 1);"],
    ["src/main/ipc/register.ts", 'ipcMain.handle("notes:" + kind, () => 1);'],
  ])("reports the other calls and a channel put together in the call, in %s: %s", (file, call) => {
    expect(rules(file, `${call}\n`)).toEqual(["ipc-channel:1"]);
  });

  it("reports a channel named by a constant of the same file, at the call", () => {
    expect(rules("src/main/ipc/register.ts", 'const CHANNEL = "notes:list";\n\nipcMain.handle(CHANNEL, () => 1);\n')).toEqual(["ipc-channel:3"]);
    expect(rules("src/main/ipc/register.ts", "const CHANNEL = `notes:${kind}`;\nipcMain.on(CHANNEL, () => undefined);\n")).toEqual(["ipc-channel:2"]);
    expect(rules("src/main/ipc/register.ts", 'import { CHANNEL } from "@shared/notes";\n\nipcMain.handle(CHANNEL, () => 1);\n')).toEqual([]);
    expect(rules("src/main/ipc/register.ts", "const CHANNEL = NOTES_CHANNELS.list;\nipcMain.handle(CHANNEL, () => 1);\n")).toEqual([]);
  });

  it("passes a channel named in src/shared/, other calls, and the constants themselves", () => {
    expect(rules("src/main/index.ts", "ipcMain.handle(IPC.appInfo, () => 1);\nipcMain.on(channel, () => undefined);\n")).toEqual([]);
    expect(rules("src/main/index.ts", 'window.once("ready-to-show", () => undefined);\napp.on("activate", () => undefined);\n')).toEqual([]);
    expect(rules("src/shared/ipc.ts", 'export const IPC = { appInfo: "app:info" } as const;\n')).toEqual([]);
  });
});

describe("what belongs to Next", () => {
  it.each([
    ["use server", "use-server-placement"],
    ["use client", "use-client-placement"],
  ])('reports "%s" anywhere', (directive, rule) => {
    for (const file of [`${R}/modules/notes/components/note-form.tsx`, "src/main/index.ts", "src/shared/ipc.ts"]) {
      const findings = found(file, `"${directive}";\n\nexport const value = 1;\n`);
      expect(findings.map((finding) => finding.rule)).toEqual([rule]);
      expect(findings[0]?.message).toContain(`Remove "${directive}"`);
      expect(findings[0]?.message.endsWith("(Electron layout)")).toBe(true);
    }
  });

  it('reports "server-only" anywhere, and nothing asks for it', () => {
    expect(rules("src/main/db/client.ts", 'import "server-only";\n\nexport const value = 1;\n')).toEqual(["server-only:1"]);
    expect(rules("scripts/seed.ts", 'import "server-only";\n')).toEqual(["server-only:1"]);
    expect(rules("src/main/db/client.ts", "export const value = 1;\n")).toEqual([]);
  });
});

describe("process.env", () => {
  const source = "export const url = process.env.STORAGE_URL;\n";

  it("is read in src/main/ only", () => {
    expect(rules("src/main/index.ts", source)).toEqual([]);
    expect(rules("src/main/storage/client.ts", source)).toEqual([]);
    for (const file of ["src/preload/index.ts", `${R}/app.tsx`, "src/shared/ipc.ts"]) expect(rules(file, source), file).toEqual(["env-access:1"]);
    expect(found("src/preload/index.ts", source)[0]?.message).toContain("Read process.env in src/main/ only");
  });

  it("is not judged in the build config, which is outside src/", () => {
    expect(rules("electron.vite.config.ts", source)).toEqual([]);
  });
});

describe("a renderer module's domain/", () => {
  it("needs its test beside it, as in a Next module", () => {
    const file = `${R}/modules/notes/domain/total.ts`;
    const source = "export const total = (a: number, b: number): number => a + b;\n";
    const findings = auditSource(makeRepo().root, { file, path: file, profile: electronContent }, source);
    expect(findings.map(({ rule }) => rule)).toEqual(["domain-test"]);
    expect(findings[0]?.message).toContain(`${R}/modules/notes/domain/total.test.ts (Electron layout)`);
    const withTest = makeRepo({ [`${R}/modules/notes/domain/total.test.ts`]: "" });
    expect(auditSource(withTest.root, { file, path: file, profile: electronContent }, source)).toEqual([]);
    expect(rules("src/main/storage/total.ts", source)).toEqual([]);
  });

  it("is not a route: a long page.tsx is a component like any other", () => {
    expect(rules(`${R}/modules/notes/components/page.tsx`, "export const a = 1;\n".repeat(100))).toEqual([]);
  });
});

describe("the new rule ids", () => {
  it("are harness rules, so a legacy list tolerates them and they judge owned files only", () => {
    for (const rule of ["electron-security", "electron-bridge", "ipc-channel"]) expect(HARNESS_RULES.has(rule), rule).toBe(true);
  });
});

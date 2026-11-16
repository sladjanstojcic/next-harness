import { describe, expect, it } from "vitest";
import type { WorkspaceEntry } from "../config.ts";
import { toolScripts } from "../core/init/tool-configs.ts";
import { jscpd, JSCPD_CACHE } from "./analysis.ts";

const workspace = (shape: WorkspaceEntry["shape"]): WorkspaceEntry => ({
  path: "packages/billing",
  shape,
  tools: "eslint-prettier",
  next: shape === "next-modules",
});

describe("where jscpd writes its report", () => {
  it.each(["package", "electron-vite", "vite-spa"] as const)("in a %s workspace, the node_modules cache, since it has no .next/", (shape) => {
    const command = jscpd.check("/repo/packages/billing", workspace(shape)).command.join(" ");
    expect(command).toContain(`--output ${JSCPD_CACHE}`);
    expect(toolScripts(workspace(shape)).jscpd).toMatch(new RegExp(`--output ${JSCPD_CACHE}$`));
  });

  it("in a Next app, the preset's .next/jscpd/", () => {
    expect(jscpd.check("/repo/apps/web", workspace("next-modules")).command).not.toContain("--output");
    expect(toolScripts(workspace("next-modules")).jscpd).not.toContain("--output");
  });
});

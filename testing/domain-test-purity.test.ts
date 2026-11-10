import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, it } from "vitest";

import { templateRepo } from "./template-repo.ts";

const domain = "src/modules/status/domain";

function cruise(files: Record<string, string>): { status: number | null; output: string } {
  const { root } = templateRepo(files);
  const args = ["src/modules/status", "--config", ".dependency-cruiser.json", "--output-type", "err-long"];
  const result = spawnSync(join(root, "node_modules/.bin/depcruise"), args, { cwd: root, encoding: "utf8", timeout: 90_000 });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

const colocatedTests = {
  [`${domain}/badge-colour.ts`]: 'export const badgeColour = (up: boolean) => (up ? "green" : "red");\n',
  [`${domain}/badge-colour.test.ts`]: [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { badgeColour } from "./badge-colour";',
    'test("up is green", () => assert.equal(badgeColour(true), "green"));',
    "",
  ].join("\n"),
  [`${domain}/badge-label.test.tsx`]: 'import "react";\nimport "./badge-colour";\n',
};

it("domain purity does not judge a colocated test that imports node:test or React", () => {
  const result = cruise(colocatedTests);
  expect(result.status, result.output).toBe(0);
}, 120_000);

it("domain purity still judges the domain file beside those tests", () => {
  const result = cruise({ ...colocatedTests, [`${domain}/read-badge.ts`]: 'import "node:fs";\nimport "react";\n' });
  expect(result.status, result.output).toBe(2);
  expect(result.output).toContain("domain-pure-core");
  expect(result.output).toContain("domain-pure-path");
  expect(result.output).not.toContain(".test.ts");
}, 120_000);

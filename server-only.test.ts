import { join } from "node:path";
import { expect, it } from "vitest";
import { templateRepo } from "./testing/template-repo.ts";

it.each(["server.ts", "server/get-a.ts"])("loads %s with its server-only marker under Vitest", async (file) => {
  const repo = templateRepo();
  const source = `src/modules/a/${file}`;
  repo.write(source, 'import "server-only"; export const answer = 6 * 7;');
  const loaded: unknown = await import(join(repo.root, source));
  expect(loaded).toMatchObject({ answer: 42 });
});

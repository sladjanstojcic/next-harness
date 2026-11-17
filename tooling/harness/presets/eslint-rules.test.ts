import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { harnessRuleBlocks } from "./eslint-rules.ts";

const LAYOUTS = ["app", "app-root", "package", "electron", "spa", "pocketbase", "e2e"] as const;
const ALIASES = { renderer: ["@/", "@renderer/"], contract: ["@shared/", "@contract/"], paths: {} };

/**
 * The sha256 of each layout's JSON-encoded rule blocks: the first five from the code at 5602b2b, before the pocketbase
 * layout; pocketbase and e2e from 5db9446, before the service layout. Each was re-hashed when the type-test
 * (`*.test-d.ts`) block was added, the only change to any of them.
 */
const BEFORE: Record<string, string> = {
  app: "3436a0694f8cc9a4f12a9eee81909eebbfcd6c1968562e96df5a994ec4195028",
  "app with shadcn": "32382a5bbcf8efcfb3d793bd08d9fe9a08fb3c27d1cb129c8a5577ead7277940",
  "app-root": "adfc08ef65776fc7912b95ac2be04590784127e04ba25a4e0bffbb612bdaaea9",
  "app-root with shadcn": "32ac86c1b7e380cb9143d55881adb05a1d4b6e623fabd492e329708d43d5b9f6",
  package: "4fe05b6845313f16d581884c6f98f91c8537155e0939b6df820ab6d1df446ec0",
  "package with shadcn": "4fe05b6845313f16d581884c6f98f91c8537155e0939b6df820ab6d1df446ec0",
  electron: "21f60942364ebe384fc59a1176a91c068678cc6fd7c1eb51d7822968d5819cef",
  "electron with shadcn": "49b07f0c3695b5812327bc2e78ec1a3807ef926640afaf9bc81671cf338cb7bf",
  spa: "aca51da7dfb2c5d6f90844d0ddf51a5c38f41800efbf11d81a0db9b6161292be",
  "spa with shadcn": "b8e83edfbaa49e20c8074965a1c32b9c68847bb807ea27cfd30ca331999e123f",
  pocketbase: "ab956490e4411937d81c83bd56b432b90d482805f98e9683c65729f598e721bf",
  "pocketbase with shadcn": "ab956490e4411937d81c83bd56b432b90d482805f98e9683c65729f598e721bf",
  e2e: "e3e5dc7c74fc47ec116f52feecb149b54abb7d6e95bdcdf822f9c24de7e919f2",
  "e2e with shadcn": "e3e5dc7c74fc47ec116f52feecb149b54abb7d6e95bdcdf822f9c24de7e919f2",
  "electron with aliases": "ff8c578a859dbd8991ea9f7133d9d0392351edca825e16e290eb010cbdea2f0d",
};

const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("the rule blocks of the layouts that existed before the service layout", () => {
  const now: Record<string, string> = {
    ...Object.fromEntries(
      LAYOUTS.flatMap((layout) => [
        [layout, sha(harnessRuleBlocks(layout))],
        [`${layout} with shadcn`, sha(harnessRuleBlocks(layout, undefined, true))],
      ]),
    ),
    "electron with aliases": sha(harnessRuleBlocks("electron", ALIASES)),
  };

  it.each(Object.keys(BEFORE))("%s stays exactly as it was", (layout) => {
    expect(now[layout], `the rule blocks of ${layout} changed`).toBe(BEFORE[layout]);
  });

  it("covers every case it hashes", () => {
    expect(Object.keys(now).sort()).toEqual(Object.keys(BEFORE).sort());
  });
});

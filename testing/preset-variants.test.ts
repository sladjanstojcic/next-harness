import { describe, expect, it } from "vitest";
import { SOURCE_PROBES } from "../shapes/next-probes.ts";
import { expectedRules } from "../tools/eslint-preset.ts";
import { APP, initialised, presetFindings } from "./preset-fixture.ts";

const IMPORT = 'import { harnessEslint } from "./tooling/harness/presets/eslint.ts";';
const withPreset = (after: string): string =>
  `${IMPORT}\nexport default [{ rules: { "no-console": "error" } }, ...harnessEslint({ root: import.meta.dirname, next: true }), ${after}];\n`;

/** Probes take a short hyphenated name and a 20-character one with a digit in turn, so each fixed name class meets a probe. */
const SHORT = "pro-be";
const LONG = "probeprobe2probeprob";
const alternating = (): (() => string) => {
  let count = 0;
  return () => (count++ % 2 === 0 ? SHORT : LONG);
};

const ANY = "@typescript-eslint/no-explicit-any";
const OFF_ANY = `"${ANY}": "off"`;
const ALL = SOURCE_PROBES.map((probe) => probe.replaceAll("{name}", "N"));
const [APP_TS, APP_TSX, MODULE_TOP, COMPONENT_TS, COMPONENT_TSX, SERVER, ACTION, DOMAIN, COMPONENT_AREA, SERVER_AREA, DOMAIN_AREA, DOMAIN_TEST] = ALL;
const [SHARED_COMPONENT, , HOOK, , SCRIPT, APP_PAGE, APP_LAYOUT, APP_ROUTE, DEEP_PAGE, GROUP_PAGE, DYNAMIC_PAGE] = ALL.slice(12);
const [MODULE_INDEX, MODULE_SERVER, MODULE_SCHEMAS, MODULE_TYPES, ...STARTER] = ALL.slice(23);
const LOG = STARTER.at(-1);
const MODULE_CODE = ALL.filter((probe) => probe.startsWith("src/modules/"));
const SHORT_NAMED_MODULE_CODE = MODULE_CODE.filter((probe) => ALL.indexOf(probe) % 2 === 0);
const LONG_NAMED_MODULE_CODE = MODULE_CODE.filter((probe) => ALL.indexOf(probe) % 2 === 1);
const SHORTER_THAN_12 = Array.from({ length: 11 }, (_, index) => "?".repeat(index + 1)).join(",");

const summary = (findings: { rule: string; message: string }[]): string[] =>
  findings
    .map(({ rule, message }) => {
      const named = message.replaceAll(LONG, "N").replaceAll(SHORT, "N");
      return `${rule} ${/^(\S+) is not active as the harness sets it for (\S+)/.exec(named)?.slice(1).join(" ") ?? message}`;
    })
    .sort();
const expected = (rules: string[], probes: (string | undefined)[]): string[] =>
  rules.flatMap((rule) => probes.map((probe) => `preset-missing ${rule} ${probe ?? ""}`)).sort();
const except = (...left: (string | undefined)[]): string[] => ALL.filter((probe) => !left.includes(probe));
const everyRule = (probes: (string | undefined)[]): string[] =>
  probes
    .flatMap((probe) => {
      const rules = Object.entries(expectedRules(probe ?? "")).filter(([, setting]) => setting !== "off");
      return [...rules.map(([rule]) => rule), "linterOptions.noInlineConfig"].map((rule) => `preset-missing ${rule} ${probe ?? ""}`);
    })
    .sort();

describe("the presence check after the preset", () => {
  it.each([
    ["a rule off for module code", `{ files: ["src/modules/**"], rules: { ${OFF_ANY} } }`, expected([ANY], MODULE_CODE)],
    [
      "a rule off for .tsx files",
      '{ files: ["**/*.tsx"], rules: { "@typescript-eslint/no-floating-promises": "off" } }',
      expected(
        ["@typescript-eslint/no-floating-promises"],
        [APP_TSX, COMPONENT_TSX, COMPONENT_AREA, SHARED_COMPONENT, APP_PAGE, APP_LAYOUT, DEEP_PAGE, GROUP_PAGE, DYNAMIC_PAGE],
      ),
    ],
    ["a rule off in domain/", `{ files: ["src/modules/*/domain/**"], rules: { ${OFF_ANY} } }`, expected([ANY], [DOMAIN, DOMAIN_AREA, DOMAIN_TEST])],
    ["a rule off in actions/", `{ files: ["src/modules/*/actions/**"], rules: { ${OFF_ANY} } }`, expected([ANY], [ACTION])],
    ["a rule off for .ts components", `{ files: ["src/modules/*/components/**/*.ts"], rules: { ${OFF_ANY} } }`, expected([ANY], [COMPONENT_TS])],
    ["a rule off for .ts route files", `{ files: ["src/app/**/*.ts"], rules: { ${OFF_ANY} } }`, expected([ANY], [APP_TS, APP_ROUTE])],
    [
      "a rule off at a module's top level",
      `{ files: ["src/modules/*/*.ts"], rules: { ${OFF_ANY} } }`,
      expected([ANY], [MODULE_TOP, MODULE_INDEX, MODULE_SERVER, MODULE_SCHEMAS, MODULE_TYPES]),
    ],
    [
      "a rule off in shared components and hooks",
      `{ files: ["src/shared/components/**", "src/shared/hooks/**"], rules: { ${OFF_ANY} } }`,
      expected([ANY], [SHARED_COMPONENT, HOOK]),
    ],
    ["domain/ ignored globally", '{ ignores: ["src/modules/*/domain/**"] }', everyRule([DOMAIN, DOMAIN_AREA, DOMAIN_TEST])],
    [
      "neutered options",
      '{ rules: { "max-lines": ["error", { max: 100000 }], "no-restricted-syntax": ["error", { selector: "DebuggerStatement" }], "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": false }] } }',
      expected(["max-lines", "no-restricted-syntax", "@typescript-eslint/ban-ts-comment"], ALL),
    ],
    [
      "max-lines skipping blank and comment lines",
      '{ rules: { "max-lines": ["error", { max: 250, skipBlankLines: true, skipComments: true }] } }',
      expected(["max-lines"], ALL),
    ],
    [
      "a rule off for letter-only kebab-case module names",
      `{ files: ["src/modules/+([a-z-])/**"], rules: { ${OFF_ANY} } }`,
      expected([ANY], SHORT_NAMED_MODULE_CODE),
    ],
    [
      "a rule off for module names shorter than 12",
      `{ files: ["src/modules/{${SHORTER_THAN_12}}/**"], rules: { ${OFF_ANY} } }`,
      expected([ANY], SHORT_NAMED_MODULE_CODE),
    ],
    ["a rule off for hyphenated module names", `{ files: ["src/modules/*-*/**"], rules: { ${OFF_ANY} } }`, expected([ANY], SHORT_NAMED_MODULE_CODE)],
    ["a rule off in component area folders", `{ files: ["src/modules/*/components/*/**"], rules: { ${OFF_ANY} } }`, expected([ANY], [COMPONENT_AREA])],
    ["a rule off in tests", `{ files: ["**/*.test.{ts,tsx}"], rules: { ${OFF_ANY} } }`, expected([ANY], [DOMAIN_TEST])],
    ["a rule off in scripts/ and e2e/", `{ files: ["scripts/**", "e2e/**"], rules: { ${OFF_ANY} } }`, expected([ANY], [SCRIPT])],
    [
      "rules outside the key set off",
      '{ rules: { "@typescript-eslint/no-unsafe-assignment": "off", "@typescript-eslint/no-non-null-assertion": "off", "no-console": "off", "@typescript-eslint/no-unsafe-type-assertion": "off" } }',
      [
        ...expected(["@typescript-eslint/no-unsafe-assignment"], ALL),
        ...expected(["@typescript-eslint/no-non-null-assertion"], except(DOMAIN_TEST)),
        ...expected(["no-console"], except(SCRIPT, LOG)),
        ...expected(["@typescript-eslint/no-unsafe-type-assertion"], except(SERVER, SERVER_AREA, DOMAIN_TEST)),
      ].sort(),
    ],
    [
      "no-restricted-syntax off in module entry files",
      '{ files: ["src/modules/*/index.ts", "src/modules/*/server.ts"], rules: { "no-restricted-syntax": "off" } }',
      expected(["no-restricted-syntax"], [MODULE_INDEX, MODULE_SERVER]),
    ],
    [
      "a rule off in Next special files",
      `{ files: ["src/app/**/page.tsx", "src/app/**/layout.tsx", "src/app/**/route.ts"], rules: { ${OFF_ANY} } }`,
      expected([ANY], [APP_PAGE, APP_LAYOUT, APP_ROUTE, DEEP_PAGE, GROUP_PAGE, DYNAMIC_PAGE]),
    ],
    ["a rule off for routes two levels deep", `{ files: ["src/app/*/*/*"], rules: { ${OFF_ANY} } }`, expected([ANY], [DEEP_PAGE, GROUP_PAGE])],
    [
      "a rule off under route groups and dynamic segments",
      `{ files: ["src/app/\\\\(*\\\\)/**", "src/app/\\\\[*\\\\]/**"], rules: { ${OFF_ANY} } }`,
      expected([ANY], [GROUP_PAGE, DYNAMIC_PAGE]),
    ],
    [
      "a rule off in the starter helpers",
      `{ files: ["src/shared/lib/{env,define-action,user-error,format,log}.ts"], rules: { ${OFF_ANY} } }`,
      expected([ANY], STARTER),
    ],
    [
      "a rule off for module names of 15 or more",
      `{ files: ["src/modules/???????????????*/**"], rules: { ${OFF_ANY} } }`,
      expected([ANY], LONG_NAMED_MODULE_CODE),
    ],
    ["a rule off for module names with a digit", `{ files: ["src/modules/*[0-9]*/**"], rules: { ${OFF_ANY} } }`, expected([ANY], LONG_NAMED_MODULE_CODE)],
    ["no-eval relaxed with an option the preset leaves unset", '{ rules: { "no-eval": ["error", { allowIndirect: true }] } }', expected(["no-eval"], ALL)],
  ])(
    "catches %s",
    async (_variant, override, findings) => {
      const repo = initialised({ ...APP, "eslint.config.mjs": withPreset(override) });
      expect(summary(await presetFindings(repo.root, alternating()))).toEqual(findings);
    },
    120_000,
  );
});

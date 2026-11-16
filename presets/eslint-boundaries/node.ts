/** The import boundaries of a Node service, as no-restricted-imports options on the alias `#/`; no ESLint import. */
import { builtinModules } from "node:module";
import { block, type BoundaryBlock, type Pattern } from "./electron.ts";

const LAYOUT = "(Node layout)";
const TESTS = ["**/*.test.ts"];

/**
 * One block per part, later blocks replacing earlier ones for the files both match, so each repeats the patterns before
 * it. ESLint sees the specifier as written: these judge packages, Node built-ins and `#/`, and dependency-cruiser the rest.
 */
/** A block that also bans each Node built-in by its bare name (`fs`), with the same message as `node:fs`. */
const withoutNode = (files: string[], patterns: Pattern[], node: Pattern): BoundaryBlock => ({
  files,
  ignores: TESTS,
  rules: {
    "no-restricted-imports": ["error", { paths: builtinModules.map((name) => ({ name, message: node.message })), patterns: [...patterns, node] }],
  },
});

export function nodeBoundaryBlocks(): BoundaryBlock[] {
  const noReact: Pattern = { regex: "^(?:react|react-dom)(?:/|$)", message: `A service renders no UI: React has no place here ${LAYOUT}` };
  const noNode = (where: string): Pattern => ({
    regex: "^node:",
    message: `${where} does no file, process or network work of its own: that belongs in the module's data/ or in src/backend/ ${LAYOUT}`,
  });
  const noOuter: Pattern = {
    regex: "^#/(?:modules|app|backend)(?:/|$)",
    message: `Code in src/shared/ is used by every module and may import no module, app or backend client; the code that needs one belongs in src/modules/<module>/ ${LAYOUT}`,
  };
  const pureBackend: Pattern = {
    regex: "^#/(?:modules|app)(?:/|$)",
    message: `src/backend/ holds the clients and their types only: no module or app code ${LAYOUT}`,
  };
  const throughData: Pattern = {
    regex: "^#/backend(?:/|$)",
    allowTypeImports: true,
    message: `Call the backend through the module's data/, which alone imports the client from src/backend/; elsewhere import its types with "import type" ${LAYOUT}`,
  };
  const edge = ["src/app/**/*.ts", "src/modules/*/{routes,index,types,schemas}.ts"];
  return [
    block(["src/**/*.ts"], [noReact]),
    block(["src/shared/**/*.ts"], [noReact, noOuter]),
    block(["src/backend/**/*.ts"], [noReact, pureBackend]),
    block(["src/main.ts", "src/worker.ts"], [noReact, throughData], { ignores: TESTS }),
    withoutNode(edge, [noReact, throughData], noNode("The HTTP edge parses, calls a module and answers; it")),
    withoutNode(["src/modules/*/domain/**/*.ts"], [noReact, throughData], noNode("A domain/ rule is plain TypeScript and")),
  ];
}

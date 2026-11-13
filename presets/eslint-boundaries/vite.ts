/** The import boundaries of a Vite single-page app, as no-restricted-imports options on the alias `@/`; no ESLint import. */
import { block, type BoundaryBlock, type Pattern } from "./electron.ts";

const LAYOUT = "(Vite layout)";
const react = "^(?:react|react-dom)(?:/|$)";

/**
 * One block per part, later blocks replacing earlier ones for the files both match, so each repeats the patterns before
 * it. ESLint sees the specifier as written: these judge packages and `@/` only, and dependency-cruiser judges the rest.
 */
export function viteBoundaryBlocks(): BoundaryBlock[] {
  const noNode: Pattern = { regex: "^node:", message: `The app runs in the browser without Node; a server task belongs to the backend ${LAYOUT}` };
  const noOuter: Pattern = {
    regex: "^@/(?:modules|app|backend)(?:/|$)",
    message: `Code in src/shared/ is used by every module and may import no module, route or backend client; the code that needs one belongs in src/modules/<module>/ ${LAYOUT}`,
  };
  const pureBackend: Pattern = {
    regex: `^@/(?:modules|app)(?:/|$)|${react}`,
    message: `src/backend/ holds the client and its types only: no React, module or route code ${LAYOUT}`,
  };
  const pureDomain: Pattern = {
    regex: `${react}|^@/backend(?:/|$)`,
    message: `A domain/ rule is plain TypeScript: React belongs in the module's components/ or hooks/, backend calls in its data/ ${LAYOUT}`,
  };
  const throughData: Pattern = {
    regex: "^@/backend(?:/|$)",
    allowTypeImports: true,
    message: `Call the backend through the module's data/, which alone imports the client from src/backend/; elsewhere import its types with "import type" ${LAYOUT}`,
  };
  const ui = ["src/app/**/*.{ts,tsx}", "src/modules/*/{components,hooks}/**/*.{ts,tsx}", "src/modules/*/{index,types,schemas}.ts", "src/main.tsx"];
  return [
    block(["src/**/*.{ts,tsx}"], [noNode], { builtins: true }),
    block(["src/shared/**/*.{ts,tsx}"], [noNode, noOuter], { builtins: true }),
    block(["src/backend/**/*.ts"], [noNode, pureBackend], { builtins: true }),
    block(["src/modules/*/domain/**/*.ts"], [noNode, pureDomain], { builtins: true, ignores: ["**/*.test.ts"] }),
    block(ui, [noNode, throughData], { builtins: true }),
  ];
}

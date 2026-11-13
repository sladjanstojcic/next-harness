/** The import boundaries between an Electron app's three processes, as no-restricted-imports options; no ESLint import. */
import { builtinModules } from "node:module";
import { DEFAULT_ALIASES, type ElectronAliases } from "../electron-aliases.ts";

const LAYOUT = "(Electron layout)";
const RENDERER = "src/renderer/src";

export interface Pattern {
  regex: string;
  message: string;
  allowTypeImports?: boolean;
}

export interface BoundaryBlock {
  files: string[];
  ignores?: string[];
  rules: Record<string, ["error", ...unknown[]]>;
}

const escaped = (prefixes: readonly string[]): string => prefixes.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

export const block = (files: string[], patterns: Pattern[], extra: { builtins?: boolean; ignores?: string[] } = {}): BoundaryBlock => ({
  files,
  ...(extra.ignores === undefined ? {} : { ignores: extra.ignores }),
  rules: { "no-restricted-imports": ["error", { ...(extra.builtins === true ? { paths: [...builtinModules] } : {}), patterns }] },
});

/**
 * One block per part, later blocks replacing earlier ones for the files both match. ESLint sees the specifier as written,
 * so these judge packages and the project's aliases only; a relative import is judged by dependency-cruiser, which
 * resolves it, as are cycles and a module used past its index.ts.
 */
export function electronBoundaryBlocks(aliases: ElectronAliases = DEFAULT_ALIASES): BoundaryBlock[] {
  const renderer = `^(?:${escaped(aliases.renderer)})`;
  const contract = `^(?:${escaped(aliases.contract)})`;
  const react = "^(?:react|react-dom)(?:/|$)";
  const noNode: Pattern = {
    regex: "^(?:node:|electron(?:/|$))",
    message: `Window code runs in a browser page without Node or Electron; ask the main process through the API on window that src/preload/ sets up ${LAYOUT}`,
  };
  const noModules: Pattern = {
    regex: `${renderer}modules(?:/|$)`,
    message: `Code in the renderer's shared/ is used by every module and may import none; the code that needs a module belongs in ${RENDERER}/modules/<module>/ ${LAYOUT}`,
  };
  const pureDomain: Pattern = { regex: react, message: `A domain/ rule is plain TypeScript; React belongs in the module's components/ or hooks/ ${LAYOUT}` };
  const pureContract: Pattern = {
    regex: `^(?:node:|(?:electron|react|react-dom)(?:/|$))|${renderer}`,
    message: `All three parts load src/shared/, so it holds types, constants and guards only: no Node, Electron or React, and no window code ${LAYOUT}`,
  };
  const noWindowCode: Pattern = {
    regex: `${renderer}|${react}`,
    message: `The main process and the preload script run outside the page; they take no window code and no React ${LAYOUT}`,
  };
  const bridgeOnly: Pattern = {
    regex: String.raw`^(?!electron(?:/|$)|\.|${contract.slice(1)})`,
    message: `A preload script is the bridge and nothing more: it imports electron and the contract in src/shared/ ${LAYOUT}`,
  };
  return [
    block(["src/renderer/**/*.{ts,tsx}"], [noNode], { builtins: true }),
    block([`${RENDERER}/shared/**/*.{ts,tsx}`], [noNode, noModules], { builtins: true }),
    block([`${RENDERER}/modules/*/domain/**/*.ts`], [noNode, pureDomain], { builtins: true, ignores: ["**/*.test.ts"] }),
    block(["src/shared/**/*.ts"], [pureContract], { builtins: true }),
    block(["src/main/**/*.ts"], [noWindowCode]),
    block(["src/preload/**/*.ts"], [bridgeOnly], { ignores: ["**/*.test.ts"] }),
  ];
}

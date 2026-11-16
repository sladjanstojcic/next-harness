import { ts } from "../../../tools/typescript.ts";
import type { Finding } from "../finding.ts";

/** What Node needs to run the TypeScript source as it is, and tsc to check it the way Node runs it. */
const REQUIRED: readonly { option: keyof ts.CompilerOptions; holds: (options: ts.CompilerOptions) => boolean; set: string; why: string }[] = [
  {
    option: "module",
    holds: (o) => o.module === ts.ModuleKind.NodeNext,
    set: '"module": "nodenext"',
    why: "Node's own resolution, with package.json imports and exports",
  },
  { option: "noEmit", holds: (o) => o.noEmit === true, set: '"noEmit": true', why: "Node runs the source, so tsc only checks it" },
  {
    option: "allowImportingTsExtensions",
    holds: (o) => o.allowImportingTsExtensions === true,
    set: '"allowImportingTsExtensions": true',
    why: "imports name their .ts file, as Node resolves them",
  },
  {
    option: "erasableSyntaxOnly",
    holds: (o) => o.erasableSyntaxOnly === true,
    set: '"erasableSyntaxOnly": true',
    why: "tsc then reports enums and the other syntax Node cannot strip",
  },
  {
    option: "verbatimModuleSyntax",
    holds: (o) => o.verbatimModuleSyntax === true,
    set: '"verbatimModuleSyntax": true',
    why: "a type-only import must say so, or Node loads it",
  },
  { option: "paths", holds: (o) => o.paths === undefined, set: "no paths; use package.json imports (#/*)", why: "Node does not apply tsconfig paths" },
];

/** The `tsconfig-node` rule: a node-service workspace's tsconfig.json, with what it extends, has the options Node's TypeScript support needs. */
export function nodeTsconfigFindings(file: string, options: ts.CompilerOptions): Finding[] {
  return REQUIRED.filter(({ holds }) => !holds(options)).map(({ option, set, why }) => ({
    rule: "tsconfig-node",
    file,
    message: `compilerOptions.${option} is not as Node runs TypeScript in the options in force for this tsconfig.json: set ${set}, since ${why} (Node layout)`,
  }));
}

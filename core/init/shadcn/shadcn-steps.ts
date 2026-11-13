import path from "node:path";
import { sourceRootOf, type ShapeName, type WorkspaceEntry } from "../../../config.ts";
import { usesShadcn } from "../../../presets/eslint-rules.ts";
import { aliasesOf, compilerOptionsInForce } from "../../../tools/typescript.ts";
import { managerCommands } from "../bootstrap.ts";
import { isObject, readJson } from "../files.ts";

/** Where each shape keeps its React code, from the workspace folder; the shapes not listed get no setup. */
const SOURCES: Partial<Record<ShapeName, (workspace: WorkspaceEntry) => string>> = {
  "next-modules": (workspace) => sourceRootOf(workspace),
  "vite-spa": () => "src/",
  "electron-vite": () => "src/renderer/src/",
};

/** The CSS file the scaffold's entry imports, which Tailwind's import goes into, and where its Vite plugin goes. */
const TAILWIND: Partial<Record<ShapeName, { css: string; plugins: (label: (file: string) => string) => string }>> = {
  "vite-spa": { css: "src/index.css", plugins: (label) => `plugins in ${label("vite.config.ts")}` },
  "electron-vite": { css: "src/renderer/src/assets/main.css", plugins: (label) => `renderer plugins in ${label("electron.vite.config.ts")}` },
};

/** shadcn's own aliases, pointed into shared/, where the layout keeps vendored components and the cn helper. */
const sharedAliases = (prefix: string): string =>
  `{ ${[
    ["components", "shared/components"],
    ["utils", "shared/lib/utils"],
    ["ui", "shared/ui"],
    ["lib", "shared/lib"],
    ["hooks", "shared/hooks"],
  ]
    .map(([name, folder]) => `"${name}": "${prefix}${folder}"`)
    .join(", ")} }`;

/** Whether the workspace's package.json declares Tailwind already, as create-next-app's --tailwind writes it. */
function hasTailwind(dir: string, label: string): boolean {
  const manifest = readJson(path.join(dir, "package.json"), label);
  return ["dependencies", "devDependencies"].some((key) => {
    const declared = manifest?.[key];
    return isObject(declared) && declared.tailwindcss !== undefined;
  });
}

/**
 * The hand steps that set up shadcn in one workspace, run on a fresh project of each shape before its first commit,
 * which locks the tool configs they edit. shadcn's init writes its two files where its default aliases point, which the
 * layout denies, and reads aliases from the root tsconfig.json only; Base UI is the library the knip preset expects.
 */
function workspaceTodo(root: string, workspace: WorkspaceEntry, source: string): string[] {
  const dir = path.join(root, workspace.path);
  const label = (file: string): string => path.posix.join(workspace.path, file);
  const { addDev, dlx, exec } = managerCommands(root);
  const inFolder = (command: string): string => (workspace.path === "" ? command : `(cd ${workspace.path} && ${command})`);
  const tailwind = TAILWIND[workspace.shape];
  const electron = workspace.shape === "electron-vite";
  const alias = electron ? (aliasesOf(dir).renderer[0] ?? "@/") : "@/";
  const init = `${dlx} shadcn@latest init -t ${workspace.shape === "next-modules" ? "next" : "vite"} -b base -p nova`;
  const setup = "Set up shadcn, whose components the lint rule then asks for (init does not run it)";
  const rootMapped = compilerOptionsInForce(path.join(dir, "tsconfig.json"))?.paths?.[`${alias}*`] !== undefined;
  const add = `${dlx} shadcn@latest add button utils`;
  return [
    ...(tailwind === undefined || hasTailwind(dir, label("package.json"))
      ? []
      : [
          `Add Tailwind, which shadcn styles its components with (init does not edit these files): put @import "tailwindcss"; first in ${label(tailwind.css)}, add tailwindcss() from "@tailwindcss/vite" to the ${tailwind.plugins(label)}, and run ${inFolder(`${addDev} tailwindcss @tailwindcss/vite`)}`,
        ]),
    // A vite-spa workspace gets this alias in its own Vite step, which also maps it for Vite.
    ...(!electron || rootMapped
      ? []
      : [
          `Map ${alias} in ${label("tsconfig.json")} too, where shadcn reads aliases (init does not edit it): add "compilerOptions": { "paths": { "${alias}*": ["./${source}*"] } }`,
        ]),
    electron
      ? `${setup}; it recognises Vite only by a vite.config file, so the command gives it an empty one for the run: ${inFolder(`printf 'export default {}\\n' > vite.config.ts && ${init} && rm vite.config.ts`)}`
      : `${setup}: ${inFolder(init)}`,
    `Delete the two files shadcn init wrote where the layout takes no code: rm ${label(`${source}components/ui/button.tsx`)} ${label(`${source}lib/utils.ts`)}`,
    `Point shadcn at ${label(`${source}shared/`)}, by setting "aliases" in ${label("components.json")} to: ${sharedAliases(alias)}`,
    // The scaffolds of the other two shapes take the preset's Prettier, whose later format step covers what shadcn wrote.
    electron
      ? `Add the first component and the cn helper there, and format what shadcn wrote in the project's own style: ${inFolder(`${add} && ${exec} prettier --write ${tailwind?.css ?? ""} ${source}shared/lib/utils.ts`)}`
      : `Add the first component and the cn helper there: ${inFolder(add)}`,
  ];
}

/** The shadcn setup of every React app workspace without components.json, for init's numbered list. */
export function shadcnTodo(root: string, workspaces: readonly WorkspaceEntry[]): string[] {
  return workspaces.flatMap((workspace) => {
    const source = SOURCES[workspace.shape]?.(workspace);
    return source === undefined || usesShadcn(path.join(root, workspace.path)) ? [] : workspaceTodo(root, workspace, source);
  });
}

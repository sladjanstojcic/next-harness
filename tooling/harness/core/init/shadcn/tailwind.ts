import { isObject } from "../files.ts";

/**
 * Whether a parsed package.json declares the tailwindcss package itself. A plugin such as @tailwindcss/vite alone does
 * not count: the CSS imports tailwindcss by name, and pnpm does not hoist a plugin's own dependency for it. The audit's
 * ui-stack rule and init's Tailwind step both ask here.
 */
export function declaresTailwind(manifest: unknown): boolean {
  if (!isObject(manifest)) return false;
  return [manifest.dependencies, manifest.devDependencies].some((list) => isObject(list) && list.tailwindcss !== undefined);
}

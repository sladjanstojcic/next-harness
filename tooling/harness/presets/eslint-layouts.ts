/** What each ESLint preset layout names: where adapter casts, console output and shadcn components may sit. No ESLint import. */
/**
 * Where the workspace keeps its code: an app's src/modules/ and src/shared/, the same folders at the top of an app
 * without src/ ("app-root"), a shared package's src/, an Electron app's src/main/, src/preload/, src/renderer/ and src/shared/,
 * a Vite single-page app's src/app/, src/modules/, src/backend/ and src/shared/ ("spa"), or a PocketBase backend's
 * pb_hooks/, pb_migrations/, shared/, types/ and tests/ ("pocketbase"), a Playwright suite's tests/ ("e2e"), or a Node service's src/app/, src/modules/, src/backend/ and src/shared/lib/ ("service").
 */
export type PresetLayout = "app" | "app-root" | "package" | "electron" | "spa" | "pocketbase" | "e2e" | "service";
/** The layouts with no log helper of their own: no console exemption. */
type WithoutLog = "package" | "pocketbase" | "e2e";
export const hasLog = (layout: PresetLayout): layout is Exclude<PresetLayout, WithoutLog> =>
  layout !== "package" && layout !== "pocketbase" && layout !== "e2e";
/** The layouts without UI: no shadcn controls. */
type WithoutUi = WithoutLog | "service";
export const withUi = (layout: PresetLayout): layout is Exclude<PresetLayout, WithoutUi> => hasLog(layout) && layout !== "service";

/** The folder that may hold adapter casts, as the messages name it and as the rule blocks match it. */
export const ADAPTERS: Record<Exclude<PresetLayout, "e2e">, string> = {
  app: "src/modules/<module>/server/",
  "app-root": "modules/<module>/server/",
  package: "src/server/",
  electron: "src/main/ or a guard in src/shared/",
  spa: "src/modules/<module>/data/ or src/backend/",
  pocketbase: "a declaration in types/ (PocketBase layout)",
  service: "src/modules/<module>/data/ or src/backend/",
};
export const ADAPTER_GLOBS: Record<Exclude<PresetLayout, "e2e">, string> = {
  app: "src/modules/*/server/**",
  "app-root": "modules/*/server/**",
  package: "src/server/**",
  electron: "src/{main,shared}/**",
  spa: "src/{modules/*/data,backend}/**",
  pocketbase: "types/**",
  service: "src/{modules/*/data,backend}/**",
};
/** Where console output is the point: automation, and an app's own log helper. */
export const CONSOLE: Record<Exclude<PresetLayout, WithoutLog>, string[]> = {
  app: ["tooling/**", "scripts/**", "src/shared/lib/log.ts"],
  "app-root": ["tooling/**", "scripts/**", "shared/lib/log.ts"],
  electron: ["tooling/**", "scripts/**", "src/main/**/log.ts"],
  spa: ["tooling/**", "scripts/**", "src/shared/lib/log.ts"],
  service: ["tooling/**", "scripts/**", "src/shared/lib/log.ts"],
};
/** Where the generated shadcn components live, by layout; a package holds none. */
export const UI: Record<Exclude<PresetLayout, WithoutUi>, string> = {
  app: "src/shared/ui/",
  "app-root": "shared/ui/",
  electron: "src/renderer/src/shared/ui/",
  spa: "src/shared/ui/",
};

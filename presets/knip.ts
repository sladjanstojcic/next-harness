import type { KnipConfig } from "knip";

/** Knip for a next-modules workspace: Next entry points, the starter helpers as entries, the harness and vendored code ignored. */
export function harnessKnip() {
  return {
    next: true,
    entry: ["src/shared/lib/env.ts", "src/shared/lib/user-error.ts", "src/shared/lib/format.ts", "src/shared/lib/define-action.ts", "src/shared/lib/log.ts"],
    ignore: ["src/shared/ui/**", "src/shared/lib/utils.ts", "tooling/harness/**"],
    ignoreDependencies: [
      "server-only", // Imported by server.ts and server/ files; Vitest aliases it, so it may have no static importer yet.
      "cn", // Used only by the vendored src/shared/lib/utils.ts helper.
      "@base-ui/react", // Used by vendored shadcn primitives.
      "class-variance-authority", // Used by vendored shadcn variants.
      "lucide-react", // Used by vendored shadcn icons.
    ],
  } satisfies KnipConfig;
}

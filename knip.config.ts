import type { KnipConfig } from "knip";

export default {
  next: true,
  entry: [
    "scripts/*.ts",
    "e2e/**",
    "tooling/harness/structure.ts",
    "src/shared/lib/env.ts",
    "src/shared/lib/user-error.ts",
    "src/shared/lib/format.ts",
    "src/shared/lib/define-action.ts",
    "src/shared/lib/log.ts",
  ],
  ignore: ["src/shared/ui/**", "src/shared/lib/utils.ts"],
  ignoreDependencies: [
    "cn", // Used only by the vendored src/shared/lib/utils.ts helper.
    "@base-ui/react", // Used by vendored shadcn primitives.
    "class-variance-authority", // Used by vendored shadcn variants.
    "lucide-react", // Used by vendored shadcn icons.
  ],
} satisfies KnipConfig;

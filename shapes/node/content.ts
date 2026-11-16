import { backendProfile } from "../backend-folder.ts";
import type { ContentProfile } from "../shape.ts";
import { ENV_FILE, NODE_LAYOUT as LAYOUT, nodeSourceRules } from "./source-rules.ts";

const NOT_NEXT = `is a Next.js directive, and a service has no client bundle or Server Actions; its I/O belongs in a module's data/ ${LAYOUT}`;

/**
 * A Node service reads its environment in one file, opens its backend connections in src/backend/ only, keeps its
 * relative imports inside src/, and answers clients with messages written for them.
 */
export const nodeContent: ContentProfile = {
  noActions: true,
  actionBuilders: [],
  // Matches nothing, so every "use client" is reported.
  clientFile: /(?!)/,
  aliases: { "#/": "src/" },
  envFile: ENV_FILE,
  envScope: /^src\//,
  backend: backendProfile(/^src\//, /^src\/backend\//, "src/backend/", LAYOUT),
  domainFile: /^src\/modules\/[^/]+\/domain\/(?:[^/]+\/)?[^/]+\.ts$/,
  errorScope: /^src\/(?:app\/|modules\/[^/]+\/routes\.ts$)/,
  integrationTests: /\.int\.test\.ts$/,
  packageBoundary: `Import another workspace by its package name, and keep relative imports inside src/ ${LAYOUT}`,
  sourceRoot: "src/",
  sourceRules: nodeSourceRules,
  messages: {
    serverOnly: `Remove "server-only": it is a Next.js package, and a service has no client bundle ${LAYOUT}`,
    useServer: `Remove "use server": it ${NOT_NEXT}`,
    useClient: `Remove "use client": it ${NOT_NEXT}`,
    clientImportsServer: `Import a module through its index.ts ${LAYOUT}`,
    indexExports: `Keep a module's index.ts to its own routes, data functions, types and schemas ${LAYOUT}`,
    thinPage: `{count} lines (maximum {max}) ${LAYOUT}`,
    domainTest: `Put the domain rule's test beside it at {test} ${LAYOUT}`,
    envAccess: `Read process.env in ${ENV_FILE} only, where it is validated once with Zod, and import its typed env value here ${LAYOUT}`,
    errorText: `Answer the client with a message written for it; keep raw error details in src/shared/lib/log.ts ${LAYOUT}`,
  },
};

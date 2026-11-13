import { backendProfile } from "../backend-folder.ts";
import type { ContentProfile } from "../shape.ts";
import { ENV_FILE, VITE_LAYOUT as LAYOUT, viteSourceRules } from "./source-rules.ts";

const NOT_NEXT = `is a Next.js directive and this app runs wholly in the browser; calls to the backend belong in a module's data/ ${LAYOUT}`;

/**
 * A client-side React app has no server and no Server Actions: every "use server" and "use client" is misplaced, Vite
 * exposes no `process.env` to the browser, and the backend client is opened in src/backend/ only.
 */
export const viteContent: ContentProfile = {
  noActions: true,
  actionBuilders: [],
  // Matches nothing, so every "use client" is reported.
  clientFile: /(?!)/,
  aliases: { "@/": "src/" },
  envScope: /^src\//,
  backend: backendProfile(/^src\//, /^src\/backend\//, "src/backend/", LAYOUT),
  domainFile: /^src\/modules\/[^/]+\/domain\/(?:[^/]+\/)?[^/]+\.ts$/,
  errorScope: /^src\/(?:app|(?:[^/]+\/)*components)\//,
  sourceRules: viteSourceRules,
  messages: {
    serverOnly: `Remove "server-only": it is a Next.js package and this app has no server ${LAYOUT}`,
    useServer: `Remove "use server": it ${NOT_NEXT}`,
    useClient: `Remove "use client": it ${NOT_NEXT}`,
    clientImportsServer: `Import a module through its index.ts; the backend client in src/backend/ is used from a module's data/ ${LAYOUT}`,
    indexExports: `Keep a module's index.ts to its own components, hooks, data functions, types and schemas ${LAYOUT}`,
    thinPage: `page.tsx has {count} lines (maximum {max}); move UI into src/modules/<module>/components/ and import it through index.ts ${LAYOUT}`,
    domainTest: `Put the domain rule's test beside it at {test} ${LAYOUT}`,
    envAccess: `Vite exposes no process.env to the browser; read import.meta.env in ${ENV_FILE}, where it is validated once, and import its typed env value here ${LAYOUT}`,
    errorText: `Show the user a message written for them; keep raw error details in src/shared/lib/log.ts ${LAYOUT}`,
  },
};

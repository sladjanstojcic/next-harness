import { backendProfile } from "../backend-folder.ts";
import type { ContentProfile } from "../shape.ts";
import { ELECTRON_LAYOUT as LAYOUT, electronSourceRules } from "./source-rules.ts";

const NOT_NEXT = `is a Next.js directive and this is an Electron app: renderer code runs in the window, Node code in src/main/, reached through src/preload/ ${LAYOUT}`;

/**
 * Electron has no server and no Server Actions: every "use server" and "use client" is misplaced, `process.env` is read
 * in the main process only, and a renderer module's domain/ rule has its test beside it.
 */
export const electronContent: ContentProfile = {
  noActions: true,
  actionBuilders: [],
  // Matches nothing, so every "use client" is reported.
  clientFile: /(?!)/,
  aliases: { "@/": "src/renderer/src/", "@shared/": "src/shared/" },
  envScope: /^src\//,
  envAllowed: /^src\/main\//,
  backend: backendProfile(/^src\//, /^src\/main\//, "src/main/", LAYOUT),
  domainFile: /^src\/renderer\/src\/modules\/[^/]+\/domain\/(?:[^/]+\/)?[^/]+\.ts$/,
  sourceRules: electronSourceRules,
  messages: {
    serverOnly: `Remove "server-only": it is a Next.js package; Node code belongs in src/main/ ${LAYOUT}`,
    useServer: `Remove "use server": it ${NOT_NEXT}`,
    useClient: `Remove "use client": it ${NOT_NEXT}`,
    clientImportsServer: `The renderer reaches the main process through the API src/preload/ exposes on window ${LAYOUT}`,
    indexExports: `Keep a module's index.ts to its own components, hooks, types and schemas ${LAYOUT}`,
    thinPage: `page.tsx has {count} lines (maximum {max}); move UI into the module's components/ ${LAYOUT}`,
    domainTest: `Put the domain rule's test beside it at {test} ${LAYOUT}`,
    envAccess: `Read process.env in src/main/ only, and pass the value on through the contract in src/shared/; the renderer and the preload script have no environment of their own ${LAYOUT}`,
    errorText: `Show the user a message written for them; keep raw error details in the main process ${LAYOUT}`,
  },
};

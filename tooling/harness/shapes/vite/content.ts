import type { ContentProfile } from "../shape.ts";

export const VITE_LAYOUT = "(Vite layout)";

const NOT_NEXT = `is a Next.js directive and this app runs wholly in the browser; calls to the backend belong in a module's data/ ${VITE_LAYOUT}`;

/** A client-side React app: no server and no Server Actions. Its content rules are switched on one by one. */
export const viteContent: ContentProfile = {
  actionBuilders: [],
  aliases: { "@/": "src/" },
  messages: {
    serverOnly: `Remove "server-only": it is a Next.js package and this app has no server ${VITE_LAYOUT}`,
    useServer: `Remove "use server": it ${NOT_NEXT}`,
    useClient: `Remove "use client": it ${NOT_NEXT}`,
    clientImportsServer: `Import a module through its index.ts; the backend client in src/backend/ is used from a module's data/ ${VITE_LAYOUT}`,
    indexExports: `Keep a module's index.ts to its own components, hooks, data functions, types and schemas ${VITE_LAYOUT}`,
    thinPage: `page.tsx has {count} lines (maximum {max}); move UI into src/modules/<module>/components/ and import it through index.ts ${VITE_LAYOUT}`,
    domainTest: `Put the domain rule's test beside it at {test} ${VITE_LAYOUT}`,
    envAccess: `Read and validate environment variables in src/shared/lib/env.ts; import its typed env value here ${VITE_LAYOUT}`,
    errorText: `Show the user a message written for them; keep raw error details in src/shared/lib/log.ts ${VITE_LAYOUT}`,
  },
};

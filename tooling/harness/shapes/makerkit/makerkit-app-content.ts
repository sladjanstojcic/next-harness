import type { ContentProfile } from "../shape.ts";

export const ROUTE_ACTION_FILE = /(?:^|\/)_lib\/server\/(?:[a-z0-9-]+-)?server-actions\.ts$/;
export const MAKERKIT_INLINE_DISABLE = "Remove the {directive} comment and fix the code it silences; owned code may not turn off lint rules or type checks.";
export const MAKERKIT_ACTION_BUILDERS: readonly string[] = ["authActionClient", "publicActionClient", "captchaActionClient", "adminActionClient"];

export const makerkitAppContent: ContentProfile = {
  actionFile: ROUTE_ACTION_FILE,
  actionBuilders: MAKERKIT_ACTION_BUILDERS,
  actionImport: /(?:^|\/)_lib\/server\/(?:[a-z0-9-]+-)?server-actions$/,
  serverFile: /(?:^|\/)_lib\/server\/(?!(?:[a-z0-9-]+-)?server-actions\.ts$)/,
  clientFile: /^(?:app\/(?:.*\/)?_components\/|components\/|app\/(?:.*\/)?error\.tsx$|app\/global-error\.tsx$)/,
  aliases: { "~/config/": "config/", "~/components/": "components/", "~/lib/": "lib/", "~/": "app/" },
  envScope: /^/,
  publicEnvAllowed: true,
  inlineDisable: MAKERKIT_INLINE_DISABLE,
  packageBoundary:
    "Import a feature package through its package.json exports (@kit/<name>/<export>), never by a relative path out of the app (Makerkit layout).",
  envAllowed: /^(?:config\/[^/]+\.config\.tsx?|proxy\.ts|i18n\/request\.ts|lib\/create-csp-response\.ts|next\.config\.mjs)$/,
  messages: {
    serverOnly: 'Import "server-only" in the route\'s _lib/server/ files; client-safe helpers belong in _lib/ (Makerkit layout).',
    useServer:
      'Put "use server" first in the route\'s _lib/server/server-actions.ts and build each action with authActionClient, publicActionClient, captchaActionClient or adminActionClient (Makerkit layout).',
    useClient: 'Put "use client" in the route\'s _components/, in components/, or in app error.tsx and global-error.tsx (Makerkit layout).',
    clientImportsServer:
      "Client components may not import _lib/server/ or lib/server/ code; call a Server Action from the route's _lib/server/server-actions.ts instead (Makerkit layout).",
    indexExports: "Expose a feature through its package.json exports, not an index file (Makerkit layout).",
    thinPage: "page.tsx has {count} lines (maximum {max}); move UI into the route's _components/ (Makerkit layout).",
    domainTest: "Put the rule's test beside it at {test}.",
    envAccess: "Read environment variables through a Zod schema in config/<name>.config.ts and import the typed config here (Makerkit layout).",
    errorText: "Log the driver error and throw an i18n key instead of raw error text (Makerkit layout).",
  },
};

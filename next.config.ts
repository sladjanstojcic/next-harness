import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  logging: { browserToTerminal: "warn" },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

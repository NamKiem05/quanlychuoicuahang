import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.GROWDESK_TEST_DIST_DIR ? { distDir: process.env.GROWDESK_TEST_DIST_DIR } : {}),
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  logging: { incomingRequests: { ignore: [/\/auth\/callback(?:\?|$)/] } },
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
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

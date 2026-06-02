import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  // Exclude engine files from webpack compilation
  webpack: (config, { isServer }) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ["**/src/engine/**"],
    };
    // github-client.ts lazily require()s the `async_hooks` Node builtin for
    // per-request context isolation. It's imported transitively by client
    // components for its types/helpers, so tell webpack the builtin resolves
    // to nothing in the browser bundle — the require is server-only and
    // guarded in a try/catch, so the client path is a harmless no-op.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        async_hooks: false,
      };
    }
    return config;
  },
};

export default nextConfig;

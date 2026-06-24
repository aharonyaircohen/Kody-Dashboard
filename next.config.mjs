import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  experimental: {
    // Turbopack's persistent dev cache has grown pathologically large locally.
    turbopackFileSystemCacheForDev: false,
  },
  // Keep pino (and its worker-thread transport) out of the bundle. When Next
  // bundles them, the thread-stream worker path gets rewritten to a virtual
  // `/ROOT/...` location that doesn't exist at runtime, so the logging worker
  // exits and every route that logs an error crashes with a 500. Leaving them
  // external means the worker loads from the real node_modules path.
  serverExternalPackages: ["pino", "thread-stream", "pino-pretty", "node-pty"],
  // Dev runs on Turbopack, which (unlike Next's webpack) does not auto-stub
  // Node-only builtins for the browser bundle. `@mintplex-labs/piper-tts-web`
  // (lazy-loaded by the voice TTS hook) statically references `require("fs")`
  // inside a runtime `if (ENVIRONMENT_IS_NODE)` guard, so the browser build
  // fails to resolve `fs` and the whole layout 500s. Point it at an empty
  // stub for the browser — the require is never reached at runtime client-side.
  turbopack: {
    resolveAlias: {
      fs: { browser: "./src/dashboard/lib/empty-module.js" },
    },
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

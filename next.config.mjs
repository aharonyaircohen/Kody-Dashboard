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
  async redirects() {
    return [
      {
        source: "/cms/:path*",
        destination: "/content/entries/:path*",
        permanent: false,
      },
      {
        source: "/content-model",
        destination: "/content/models",
        permanent: false,
      },
      {
        source: "/cms-config",
        destination: "/content/settings",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/repo/:owner/:repo",
        destination: "/",
      },
      {
        source: "/repo/:owner/:repo/:path*",
        destination: "/:path*",
      },
    ];
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
  // The chat core/platform layers ship as TS source from @kody-ade/kody-chat;
  // Next must compile them like project code. The package imports its shared
  // host libs via the `@dashboard` alias — the resolveAlias entries below make
  // those resolve to THIS repo's src/dashboard so there is exactly one module
  // instance (github-client context, active-repo state, React contexts).
  transpilePackages: ["@kody-ade/kody-chat"],
  // Dev runs on Turbopack, which (unlike Next's webpack) does not auto-stub
  // Node-only builtins for the browser bundle. `@mintplex-labs/piper-tts-web`
  // (lazy-loaded by the voice TTS hook) statically references `require("fs")`
  // inside a runtime `if (ENVIRONMENT_IS_NODE)` guard, so the browser build
  // fails to resolve `fs` and the whole layout 500s. Point it at an empty
  // stub for the browser — the require is never reached at runtime client-side.
  turbopack: {
    resolveAlias: {
      fs: { browser: "./src/dashboard/lib/empty-module.js" },
      // github-client's per-request context lazily requires async_hooks; the
      // languages manager now reaches it from a client chain, so Turbopack
      // needs the same browser stub webpack gets via resolve.fallback.
      async_hooks: { browser: "./src/dashboard/lib/empty-module.js" },
      "@dashboard/*": "./src/dashboard/*",
      "@/*": "./src/*",
      "@kody-chat/*": "./node_modules/@kody-ade/kody-chat/src/dashboard/lib/*",
    },
  },
  // Exclude engine files from webpack compilation
  webpack: (config, { isServer }) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ["**/src/engine/**"],
    };
    // tsconfig paths don't apply to files inside node_modules — the
    // @kody-ade/kody-chat sources need @dashboard/@/ resolved explicitly.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@dashboard": new URL("./src/dashboard", import.meta.url).pathname,
      "@": new URL("./src", import.meta.url).pathname,
      "@kody-chat": new URL(
        "./node_modules/@kody-ade/kody-chat/src/dashboard/lib",
        import.meta.url,
      ).pathname,
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

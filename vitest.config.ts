import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  // Match Next/SWC's automatic JSX runtime so JSX-containing modules
  // (e.g. kody-chat-helpers.tsx) can be imported in unit tests without a
  // global `React` in scope.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    // Playwright specs live under tests/e2e — vitest must not load them.
    exclude: ["node_modules/**", "tests/e2e/**"],
    server: {
      deps: {
        // @kody-ade/kody-chat ships TS source — vitest must transform it
        // instead of treating it as a prebuilt external. Its @dashboard
        // imports then resolve via the aliases below, back into this repo
        // (single module instance for shared libs).
        inline: [/@kody-ade\/kody-chat/],
      },
    },
    coverage: {
      reporter: ["text", "json", "html"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@dashboard": resolve(__dirname, "./src/dashboard"),
      "@kody-chat": resolve(
        __dirname,
        "./node_modules/@kody-ade/kody-chat/src/dashboard/lib",
      ),
      // `server-only` throws outside an RSC build — stub it so server-only
      // utilities remain unit-testable.
      "server-only": resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});

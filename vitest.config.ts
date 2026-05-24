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
    coverage: {
      reporter: ["text", "json", "html"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@dashboard": resolve(__dirname, "./src/dashboard"),
      // `server-only` throws outside an RSC build — stub it so server-only
      // utilities (vapid-keys, pool-keys) are unit-testable.
      "server-only": resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});

import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import reactPlugin from "eslint-plugin-react";
import jsxA11y from "eslint-plugin-jsx-a11y";
import nextPlugin from "@next/eslint-plugin-next";
import importPlugin from "eslint-plugin-import";

import { CHAT_PLUGIN_DIRS } from "./src/dashboard/lib/chat/plugins/plugin-dirs.mjs";

// Chat-platform layering (docs/chat-platform-phase1.md, "Standing rules"):
// core ← platform ← plugins/surface. Zones below make violations lint
// ERRORS, so every step's gate catches them. CHAT_PLUGIN_DIRS is shared
// with tests/unit/chat-platform/plugin-dirs.spec.ts, which fails when the
// list drifts from the directories actually on disk.
const CHAT = "./src/dashboard/lib/chat";
const chatLayerZones = [
  // core is the bottom layer: no platform/surface/plugins/legacy components.
  { target: `${CHAT}/core`, from: `${CHAT}/surface`, message: "core must not import surface" },
  { target: `${CHAT}/core`, from: `${CHAT}/plugins`, message: "core must not import plugins" },
  { target: `${CHAT}/core`, from: `${CHAT}/platform`, message: "core must not import platform" },
  { target: `${CHAT}/core`, from: "./src/dashboard/lib/components", message: "core must not import components" },
  // platform sits above core only.
  { target: `${CHAT}/platform`, from: `${CHAT}/surface`, message: "platform must not import surface" },
  { target: `${CHAT}/platform`, from: `${CHAT}/plugins`, message: "platform must not import plugins" },
  { target: `${CHAT}/platform`, from: "./src/dashboard/lib/components", message: "platform must not import components" },
  // plugins may use platform + core, never each other.
  ...CHAT_PLUGIN_DIRS.map((dir) => ({
    target: `${CHAT}/plugins/${dir}`,
    from: `${CHAT}/plugins`,
    except: [`./${dir}`],
    message: `plugins must not import sibling plugins (${dir})`,
  })),
];

export default [
  {
    name: "ignore-patterns",
    ignores: [
      "**/node_modules/**",
      "**/.kody/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "next-env.d.ts",
    ],
  },
  {
    name: "base-config",
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks,
      react: reactPlugin,
      "jsx-a11y": jsxA11y,
      "@next/next": nextPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/triple-slash-reference": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "jsx-a11y/no-autofocus": "off",
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-static-element-interactions": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "jsx-a11y/heading-has-content": "off",
      "jsx-a11y/label-has-associated-control": "off",
    },
  },
  {
    // Chat platform: strict standards + layering. These are ERRORS (the
    // repo-wide config only warns) — the refactor gate runs lint blocking.
    name: "chat-platform-standards",
    files: ["src/dashboard/lib/chat/**/*.ts", "src/dashboard/lib/chat/**/*.tsx"],
    plugins: { import: importPlugin },
    settings: {
      // Resolve .ts/.tsx so the relative-path layer zones fire. Alias-form
      // imports (@dashboard/...) are enforced by the per-layer
      // no-restricted-imports blocks below — no extra resolver dependency.
      "import/resolver": {
        node: { extensions: [".js", ".ts", ".tsx"] },
      },
    },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "max-lines": ["error", { max: 800, skipBlankLines: true, skipComments: true }],
      "import/no-restricted-paths": ["error", { zones: chatLayerZones }],
    },
  },
  {
    // KodyChat size RATCHET: the file lives outside the chat/** zone, so
    // nothing else stops regrowth. Lower this cap with every phase-1.6
    // extraction — never raise it. (Raw lines; currently 2,828 after the
    // phase-1.6b send-pipeline extraction to kody-chat-send.ts.)
    name: "kodychat-size-ratchet",
    files: ["src/dashboard/lib/components/KodyChat.tsx"],
    rules: {
      "max-lines": ["error", { max: 2880, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    // Layer zones, alias form. no-restricted-paths only sees resolvable
    // relative imports; these blocks close the @dashboard/@ alias route.
    name: "chat-core-alias-zones",
    files: ["src/dashboard/lib/chat/core/**/*.ts", "src/dashboard/lib/chat/core/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["@dashboard/lib/chat/surface*", "@/dashboard/lib/chat/surface*"], message: "core must not import surface" },
        { group: ["@dashboard/lib/chat/plugins*", "@/dashboard/lib/chat/plugins*"], message: "core must not import plugins" },
        { group: ["@dashboard/lib/chat/platform*", "@/dashboard/lib/chat/platform*"], message: "core must not import platform" },
        { group: ["@dashboard/lib/components*", "@/dashboard/lib/components*"], message: "core must not import components" },
      ]}],
    },
  },
  {
    name: "chat-platform-alias-zones",
    files: ["src/dashboard/lib/chat/platform/**/*.ts", "src/dashboard/lib/chat/platform/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["@dashboard/lib/chat/surface*", "@/dashboard/lib/chat/surface*"], message: "platform must not import surface" },
        { group: ["@dashboard/lib/chat/plugins*", "@/dashboard/lib/chat/plugins*"], message: "platform must not import plugins" },
        { group: ["@dashboard/lib/components*", "@/dashboard/lib/components*"], message: "platform must not import components" },
      ]}],
    },
  },
  ...CHAT_PLUGIN_DIRS.map((dir) => ({
    name: `chat-plugin-${dir}-alias-zones`,
    files: [`src/dashboard/lib/chat/plugins/${dir}/**/*.ts`, `src/dashboard/lib/chat/plugins/${dir}/**/*.tsx`],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        {
          group: CHAT_PLUGIN_DIRS.filter((d) => d !== dir).flatMap((d) => [
            `@dashboard/lib/chat/plugins/${d}*`,
            `@/dashboard/lib/chat/plugins/${d}*`,
          ]),
          message: `plugins must not import sibling plugins (${dir})`,
        },
      ]}],
    },
  })),
  {
    // Playwright e2e specs are not React. Its fixture API names callbacks
    // `use` (`await use(ctx)`), which the react-hooks plugin mistakes for
    // React's `use()` hook and flags as a rules-of-hooks violation. Turn the
    // rule off here — there are no React hooks in these files to protect.
    name: "playwright-e2e",
    files: ["tests/e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
];

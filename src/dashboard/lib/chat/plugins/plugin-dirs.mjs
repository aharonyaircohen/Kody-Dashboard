/**
 * @fileType module
 * @domain chat-platform
 * @pattern shared-constant
 * @ai-summary Single source of truth for the chat plugin directory names.
 *   eslint.config.mjs builds the per-plugin lint zones (no sibling-plugin
 *   imports) from this list, and tests/unit/chat-platform/plugin-dirs.spec.ts
 *   guards that it matches the directories actually present under
 *   src/dashboard/lib/chat/plugins/. Plain .mjs (not .ts) because the eslint
 *   flat config runs directly under node with no TS loader.
 *   Adding a plugin dir without updating this list fails the unit gate.
 */

export const CHAT_PLUGIN_DIRS = Object.freeze([
  "terminal",
  "commands",
  "vibe",
  "goals",
  "branding",
  "tasks",
  // Phase 2 step 4 — page-plugins migrated via the tasks-pilot recipe.
  "activity",
  "agency-runs",
  "agent-goals",
  "agent-loops",
  "agents",
  "capabilities",
  "changelog",
  "commands-page",
  "company",
  "company-intents",
  "config",
  "context",
  "docs",
  "files",
  "inbox",
  "instructions",
  "memory",
  "messages",
  "models",
  "notifications",
  "preview",
  "reports",
  "secrets",
  "settings",
  "store-catalog",
  "todos",
  "variables",
  "workflows",
]);

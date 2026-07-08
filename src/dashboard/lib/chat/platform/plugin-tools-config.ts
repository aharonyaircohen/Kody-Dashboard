/**
 * @fileType module
 * @domain chat-platform
 * @pattern plugin-tools-mcp-config
 * @ai-summary Phase 2 Step 1 — engine tool bridge (fail-open). Server-only
 *   helpers that (a) mint/verify the repo-scoped bearer credential for the
 *   plugin-tools MCP endpoint (`/api/kody/chat/plugin-tools/mcp`) and
 *   (b) produce the engine-shaped `claudeCode.mcpServers` entry that points
 *   an engine agent at that endpoint. Signing follows the chat-token
 *   pattern: HMAC of the scope with KODY_MASTER_KEY, purpose-prefixed
 *   (`kody-plugin-tools:`) so this use is cryptographically separated from
 *   every other consumer of the same key. No new env var.
 *
 *   Fail-open contract: `maybeAppendPluginToolsToken` is a byte-level no-op
 *   while no plugin has registered server tools — the trigger route's
 *   dispatch payload stays identical to today's.
 */

import "server-only";

import crypto from "crypto";

import { getChatServerToolRegistry } from "./server-tools";

/** Route path of the MCP-over-HTTP endpoint serving the plugin tool registry. */
export const PLUGIN_TOOLS_MCP_PATH = "/api/kody/chat/plugin-tools/mcp";

/** MCP server name the engine sees (allowlist token: `mcp__kody-plugin-tools`). */
export const PLUGIN_TOOLS_MCP_SERVER_NAME = "kody-plugin-tools";

const TOKEN_BYTES = 16; // 128 bits of HMAC output, matching chat-token.ts

function getSecret(): string {
  const s = process.env.KODY_MASTER_KEY;
  if (!s) throw new Error("KODY_MASTER_KEY not configured");
  // Purpose prefix separates this HMAC family from kody-chat-token:,
  // kody-token-encryption:, kody-preview:, … (same master key, distinct use).
  return `kody-plugin-tools:${s}`;
}

function scopeOf(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

/** Hex HMAC signature scoped to one repo. Stateless — verify by re-minting. */
export function mintPluginToolsToken(owner: string, repo: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(scopeOf(owner, repo))
    .digest("hex")
    .slice(0, TOKEN_BYTES * 2);
}

/**
 * Self-describing bearer credential: `owner/repo:signature`. The scope rides
 * inside the credential so the MCP endpoint needs no extra headers/params.
 * GitHub owner/repo names cannot contain `:`, so the last `:` is the split.
 */
export function buildPluginToolsBearer(owner: string, repo: string): string {
  return `${scopeOf(owner, repo)}:${mintPluginToolsToken(owner, repo)}`;
}

export interface PluginToolsScope {
  owner: string;
  repo: string;
}

/** Verify a bearer credential; returns its repo scope, or null if invalid. */
export function verifyPluginToolsBearer(
  bearer: string,
): PluginToolsScope | null {
  const sep = bearer.lastIndexOf(":");
  if (sep <= 0 || sep === bearer.length - 1) return null;
  const scope = bearer.slice(0, sep);
  const sig = bearer.slice(sep + 1);
  const slash = scope.indexOf("/");
  if (slash <= 0 || slash === scope.length - 1) return null;
  const owner = scope.slice(0, slash);
  const repo = scope.slice(slash + 1);

  // Exact-shape check first: Buffer.from(.., "hex") silently truncates
  // odd-length or partially-invalid hex, which would let e.g. `sig + "0"`
  // decode to the same bytes as `sig`. Reject anything but 32 hex chars.
  if (!/^[a-f0-9]{32}$/.test(sig)) return null;
  const expected = mintPluginToolsToken(owner, repo);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return { owner, repo };
}

/** Absolute URL of the plugin-tools MCP endpoint for a dashboard origin. */
export function pluginToolsMcpUrl(dashboardUrl: string): string {
  return `${dashboardUrl.replace(/\/+$/, "")}${PLUGIN_TOOLS_MCP_PATH}`;
}

/**
 * Engine-shaped `claudeCode.mcpServers` entry (see the engine's
 * `McpServerSpec` — `{ name, command, args?, env? }`, stdio only). The engine
 * spawns stdio MCP servers, so the HTTP endpoint is bridged with the standard
 * `mcp-remote` shim. Drops straight into a capability/duty profile via the
 * existing Capabilities flow ([capabilities/profile.ts] `composeProfile`,
 * which also derives the `mcp__kody-plugin-tools` allowlist token).
 *
 * This helper only PRODUCES the entry — writing it into a consumer repo's
 * profile is an explicit UI/operator action, never done silently.
 */
export function buildPluginToolsMcpServerSpec(options: {
  dashboardUrl: string;
  owner: string;
  repo: string;
}): { name: string; command: string; args: string[] } {
  const bearer = buildPluginToolsBearer(options.owner, options.repo);
  return {
    name: PLUGIN_TOOLS_MCP_SERVER_NAME,
    command: "npx",
    args: [
      "-y",
      "mcp-remote",
      pluginToolsMcpUrl(options.dashboardUrl),
      "--header",
      `Authorization: Bearer ${bearer}`,
    ],
  };
}

/**
 * Fail-open trigger-route hook: when at least one plugin has registered
 * server tools, append a `pluginTools` bearer to the dashboardUrl the engine
 * receives (the engine ignores unknown query params today; a future engine
 * version can use it to self-configure the MCP client — no YAML change).
 * With zero registered plugins this returns the URL unchanged, keeping the
 * dispatch payload byte-identical to the pre-bridge behavior.
 */
export function maybeAppendPluginToolsToken(
  url: string,
  owner: string,
  repo: string,
): string {
  if (getChatServerToolRegistry().pluginIds().length === 0) return url;
  const bearer = buildPluginToolsBearer(owner, repo);
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}pluginTools=${encodeURIComponent(bearer)}`;
}

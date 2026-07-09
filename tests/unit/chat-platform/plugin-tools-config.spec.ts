/**
 * @fileoverview Unit tests for the plugin-tools MCP config helpers
 *   (phase 2 step 1 — engine tool bridge).
 * @testFramework vitest
 * @domain chat-platform
 *
 * Covers: mint/verify roundtrip, tampering, malformed bearers, purpose
 * separation from the chat ingest token family, the engine-shaped
 * mcpServers entry, and the fail-open trigger hook.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  buildPluginToolsBearer,
  buildPluginToolsMcpServerSpec,
  maybeAppendPluginToolsToken,
  mintPluginToolsToken,
  PLUGIN_TOOLS_MCP_PATH,
  pluginToolsMcpUrl,
  verifyPluginToolsBearer,
} from "@dashboard/lib/chat/platform/plugin-tools-config";
import { getChatServerToolRegistry } from "@dashboard/lib/chat/platform/server-tools";
import { mintSessionToken } from "@dashboard/lib/chat-token";

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "test-secret-for-plugin-tools-hmac";
});

describe("plugin-tools token", () => {
  it("mints a stable hex signature and verifies the bearer roundtrip", () => {
    const sig = mintPluginToolsToken("acme", "widgets");
    expect(sig).toMatch(/^[a-f0-9]{32}$/);
    expect(mintPluginToolsToken("acme", "widgets")).toBe(sig);

    const bearer = buildPluginToolsBearer("acme", "widgets");
    expect(bearer).toBe(`acme/widgets:${sig}`);
    expect(verifyPluginToolsBearer(bearer)).toEqual({
      owner: "acme",
      repo: "widgets",
    });
  });

  it("rejects tampered scope, tampered signature, and malformed bearers", () => {
    const bearer = buildPluginToolsBearer("acme", "widgets");
    const sig = mintPluginToolsToken("acme", "widgets");

    expect(verifyPluginToolsBearer(`acme/other:${sig}`)).toBeNull();
    expect(verifyPluginToolsBearer(`evil/widgets:${sig}`)).toBeNull();
    expect(
      verifyPluginToolsBearer(
        bearer.slice(0, -1) + (bearer.endsWith("0") ? "1" : "0"),
      ),
    ).toBeNull();
    expect(verifyPluginToolsBearer("")).toBeNull();
    expect(verifyPluginToolsBearer("no-separator")).toBeNull();
    expect(verifyPluginToolsBearer("acme/widgets:")).toBeNull();
    expect(verifyPluginToolsBearer(":deadbeef")).toBeNull();
    expect(verifyPluginToolsBearer("acme:deadbeef")).toBeNull();
    expect(verifyPluginToolsBearer("acme/widgets:zz-not-hex")).toBeNull();
  });

  it("is cryptographically separated from the chat ingest token family", () => {
    // Same master key, same message — different purpose prefix, different MAC.
    const scope = "acme/widgets";
    expect(mintPluginToolsToken("acme", "widgets")).not.toBe(
      mintSessionToken(scope),
    );
  });
});

describe("mcpServers entry", () => {
  it("builds the engine-shaped stdio spec bridging to the HTTP endpoint", () => {
    const spec = buildPluginToolsMcpServerSpec({
      dashboardUrl: "https://dash.test/",
      owner: "acme",
      repo: "widgets",
    });
    expect(spec.name).toBe("kody-plugin-tools");
    expect(spec.command).toBe("npx");
    expect(spec.args).toEqual([
      "-y",
      "mcp-remote",
      `https://dash.test${PLUGIN_TOOLS_MCP_PATH}`,
      "--header",
      `Authorization: Bearer ${buildPluginToolsBearer("acme", "widgets")}`,
    ]);
  });

  it("normalizes trailing slashes in the dashboard origin", () => {
    expect(pluginToolsMcpUrl("https://dash.test///")).toBe(
      `https://dash.test${PLUGIN_TOOLS_MCP_PATH}`,
    );
  });
});

describe("maybeAppendPluginToolsToken (fail-open)", () => {
  it("returns the URL unchanged with no registered plugins, appends after registration", () => {
    const url = "https://dash.test?token=abc";
    // ORDER MATTERS: the registry is a module singleton; assert the
    // fail-open no-op before registering the fixture below.
    expect(maybeAppendPluginToolsToken(url, "acme", "widgets")).toBe(url);

    getChatServerToolRegistry().register("plugin-tools-config-fixture", () => ({
      fixture_tool: {
        description: "fixture",
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
      },
    }));

    const appended = maybeAppendPluginToolsToken(url, "acme", "widgets");
    expect(appended).toBe(
      `${url}&pluginTools=${encodeURIComponent(buildPluginToolsBearer("acme", "widgets"))}`,
    );
    // No existing query → "?" joiner.
    expect(
      maybeAppendPluginToolsToken("https://dash.test", "acme", "widgets"),
    ).toContain("?pluginTools=");
  });
});

/**
 * Unit tests for the single recipient resolver
 * (src/dashboard/lib/notifications/recipients.ts) — the one place that decides
 * "who does this event notify?". Covers the mention scrape (code-span aware,
 * bot-handle excluded), the channel-broadcast subscriber filter, and the
 * server-side per-type mute enforcement.
 */
import { describe, it, expect } from "vitest";
import {
  extractMentions,
  resolveRecipients,
} from "@dashboard/lib/notifications/recipients";
import type { ServerNotificationType } from "@dashboard/lib/notifications/recipients";

function sub(userLogin: string, channelNotify?: "off" | "mentions" | "all") {
  return {
    endpoint: `https://push/${userLogin}`,
    keys: { p256dh: "p", auth: "a" },
    userLogin,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...(channelNotify ? { channelNotify } : {}),
  };
}

function mutedMap(
  entries: [string, ServerNotificationType[]][],
): Map<string, ServerNotificationType[]> {
  return new Map(entries);
}

describe("extractMentions", () => {
  it("extracts, lower-cases, and de-dupes logins", () => {
    expect(extractMentions("hi @Alice and @bob, also @Alice")).toEqual([
      "alice",
      "bob",
    ]);
  });

  it("ignores the bot's own command handle and code-span commands", () => {
    expect(extractMentions("@kody bug --base x")).toEqual([]);
    expect(extractMentions("run `@kody sync --pr 5`")).toEqual([]);
    expect(extractMentions("```\n@kody resolve --pr 6\n```")).toEqual([]);
  });

  it("keeps a real operator mention next to a quoted command", () => {
    expect(extractMentions("@aguyaharonyair run `@kody sync`")).toEqual([
      "aguyaharonyair",
    ]);
  });

  it("does not treat an email as a mention", () => {
    expect(extractMentions("reach me at user@example.com")).toEqual([]);
  });
});

describe("resolveRecipients", () => {
  it("gates a normal event to the @mentioned humans", () => {
    const r = resolveRecipients({ body: "hey @alice", author: "bob" }, [
      sub("alice"),
      sub("carol"),
    ]);
    expect(r).toEqual({ logins: ["alice"], isChannelBroadcast: false });
  });

  it("broadcasts a channel message to all subscribers except the author", () => {
    const r = resolveRecipients(
      { body: "deploy green", author: "carol", channel: { number: 5 } },
      [sub("alice"), sub("bob"), sub("carol")],
    );
    expect(r.isChannelBroadcast).toBe(true);
    expect(r.logins.sort()).toEqual(["alice", "bob"]);
  });

  it("honors channelNotify=off and channelNotify=mentions on a broadcast", () => {
    const r = resolveRecipients(
      { body: "ping @bob", author: "carol", channel: { number: 5 } },
      [sub("alice", "off"), sub("bob", "mentions"), sub("dave", "mentions")],
    );
    // alice opted out; dave wants mentions-only but isn't mentioned; bob is.
    expect(r.logins).toEqual(["bob"]);
  });

  it("returns no recipients when nobody is mentioned", () => {
    const r = resolveRecipients({ body: "nobody here", author: "bob" }, [
      sub("alice"),
    ]);
    expect(r.logins).toEqual([]);
  });

  // ─── Per-type mute enforcement ─────────────────────────────────────────────

  it("drops a recipient who has muted the notification type (mention event)", () => {
    const muted = mutedMap([["alice", ["chat-response"]]]);
    const r = resolveRecipients(
      { body: "hey @alice", author: "bob" },
      [sub("alice")],
      { notificationType: "chat-response", mutedTypesByLogin: muted },
    );
    // alice muted chat-response → excluded even though she was @mentioned
    expect(r.logins).toEqual([]);
  });

  it("keeps a recipient who has NOT muted the notification type", () => {
    const muted = mutedMap([["alice", ["pr-ready"]]]);
    const r = resolveRecipients(
      { body: "hey @alice", author: "bob" },
      [sub("alice")],
      { notificationType: "chat-response", mutedTypesByLogin: muted },
    );
    expect(r.logins).toEqual(["alice"]);
  });

  it("drops multiple recipients who muted the type", () => {
    const muted = mutedMap([
      ["alice", ["chat-response"]],
      ["bob", ["chat-response"]],
    ]);
    const r = resolveRecipients(
      { body: "hey @alice and @bob", author: "carol" },
      [sub("alice"), sub("bob")],
      { notificationType: "chat-response", mutedTypesByLogin: muted },
    );
    expect(r.logins).toEqual([]);
  });

  it("drops a channel broadcast subscriber who muted the type", () => {
    const muted = mutedMap([["alice", ["chat-response"]]]);
    const r = resolveRecipients(
      { body: "hello everyone", author: "carol", channel: { number: 5 } },
      [sub("alice"), sub("bob")],
      { notificationType: "chat-response", mutedTypesByLogin: muted },
    );
    // alice muted chat-response → excluded; bob is still in
    expect(r.logins).toEqual(["bob"]);
  });

  it("keeps all channel subscribers when no notificationType is given (backward compat)", () => {
    const muted = mutedMap([["alice", ["chat-response"]]]);
    const r = resolveRecipients(
      { body: "hello everyone", author: "carol", channel: { number: 5 } },
      [sub("alice"), sub("bob")],
      // no notificationType
    );
    expect(r.logins.sort()).toEqual(["alice", "bob"]);
  });

  it("keeps all mention recipients when no notificationType is given (backward compat)", () => {
    const muted = mutedMap([["alice", ["chat-response"]]]);
    const r = resolveRecipients({ body: "hey @alice", author: "bob" }, [
      sub("alice"),
    ]);
    expect(r.logins).toEqual(["alice"]);
  });

  it("drops recipients who muted a different type (no false positives)", () => {
    // alice muted task-assigned but the event is chat-response → keep alice
    const muted = mutedMap([["alice", ["task-assigned"]]]);
    const r = resolveRecipients(
      { body: "hey @alice", author: "bob" },
      [sub("alice")],
      { notificationType: "chat-response", mutedTypesByLogin: muted },
    );
    expect(r.logins).toEqual(["alice"]);
  });
});

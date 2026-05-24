/**
 * Unit tests for the single recipient resolver
 * (src/dashboard/lib/notifications/recipients.ts) — the one place that decides
 * "who does this event notify?". Covers the mention scrape (code-span aware,
 * bot-handle excluded) and the channel-broadcast subscriber filter.
 */
import { describe, it, expect } from "vitest";
import {
  extractMentions,
  resolveRecipients,
} from "@dashboard/lib/notifications/recipients";

function sub(userLogin: string, channelNotify?: "off" | "mentions" | "all") {
  return {
    endpoint: `https://push/${userLogin}`,
    keys: { p256dh: "p", auth: "a" },
    userLogin,
    ...(channelNotify ? { channelNotify } : {}),
  };
}

describe("extractMentions", () => {
  it("extracts, lower-cases, and de-dupes logins", () => {
    expect(extractMentions("hi @Alice and @bob, also @Alice")).toEqual(["alice", "bob"]);
  });

  it("ignores the bot's own command handle and code-span commands", () => {
    expect(extractMentions("@kody bug --base x")).toEqual([]);
    expect(extractMentions("run `@kody sync --pr 5`")).toEqual([]);
    expect(extractMentions("```\n@kody resolve --pr 6\n```")).toEqual([]);
  });

  it("keeps a real operator mention next to a quoted command", () => {
    expect(extractMentions("@aguyaharonyair run `@kody sync`")).toEqual(["aguyaharonyair"]);
  });

  it("does not treat an email as a mention", () => {
    expect(extractMentions("reach me at user@example.com")).toEqual([]);
  });
});

describe("resolveRecipients", () => {
  it("gates a normal event to the @mentioned humans", () => {
    const r = resolveRecipients({ body: "hey @alice", author: "bob" }, [sub("alice"), sub("carol")]);
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
    const r = resolveRecipients({ body: "nobody here", author: "bob" }, [sub("alice")]);
    expect(r.logins).toEqual([]);
  });
});

/**
 * Unit tests for the slash-command parsing + substitution logic that backs
 * the chat composer's `/command` menu (the renamed Commands feature). Pure
 * functions — the robust, always-runs counterpart to the Playwright menu
 * e2e (which needs a live server).
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect } from "vitest";
import {
  parseSlashTrigger,
  expandSlashCommand,
  type SlashCommand,
} from "@dashboard/lib/commands/useSlashCommands";
import {
  substitute,
  tokenizeArguments,
} from "@dashboard/lib/commands/substitute";
import { BUILTIN_COMMANDS } from "@dashboard/lib/commands/builtins";

const COMMANDS: SlashCommand[] = [
  {
    slug: "plan",
    description: "Plan",
    argumentHint: "<feature>",
    body: "Research first, then plan: $ARGUMENTS",
    source: "builtin",
  },
  {
    slug: "review",
    description: "Review",
    argumentHint: "",
    body: "Review this PR.",
    source: "builtin",
  },
];

describe("parseSlashTrigger", () => {
  it("is inactive when the input does not start with '/'", () => {
    expect(parseSlashTrigger("")).toEqual({ active: false, filter: "" });
    expect(parseSlashTrigger("hello")).toEqual({ active: false, filter: "" });
  });

  it("is active while typing a slug with no whitespace yet", () => {
    expect(parseSlashTrigger("/")).toEqual({ active: true, filter: "" });
    expect(parseSlashTrigger("/pl")).toEqual({ active: true, filter: "pl" });
  });

  it("closes once whitespace follows the slug (args being typed)", () => {
    expect(parseSlashTrigger("/plan ")).toEqual({
      active: false,
      filter: "plan",
    });
    expect(parseSlashTrigger("/plan dark mode")).toEqual({
      active: false,
      filter: "plan",
    });
  });
});

describe("tokenizeArguments", () => {
  it("splits on whitespace", () => {
    expect(tokenizeArguments("a b c")).toEqual(["a", "b", "c"]);
  });
  it("keeps quoted segments whole", () => {
    expect(tokenizeArguments('"two words" solo')).toEqual([
      "two words",
      "solo",
    ]);
    expect(tokenizeArguments("'single quote' x")).toEqual([
      "single quote",
      "x",
    ]);
  });
});

describe("substitute", () => {
  it("replaces $ARGUMENTS with the full argument string", () => {
    const r = substitute("plan: $ARGUMENTS", "dark mode");
    expect(r.text).toBe("plan: dark mode");
    expect(r.hadPlaceholder).toBe(true);
  });

  it("replaces positional $0/$1 tokens", () => {
    expect(substitute("$0 → $1", "a b").text).toBe("a → b");
  });

  it("supports the long $ARGUMENTS[N] form", () => {
    expect(substitute("second=$ARGUMENTS[1]", "a b").text).toBe("second=b");
  });

  it("appends ARGUMENTS when the body has no placeholder but args were given", () => {
    const r = substitute("Just do it.", "now");
    expect(r.hadPlaceholder).toBe(false);
    expect(r.text).toBe("Just do it.\n\nARGUMENTS: now");
  });

  it("leaves a placeholder-free body untouched when no args", () => {
    expect(substitute("Just do it.", "").text).toBe("Just do it.");
  });
});

describe("expandSlashCommand", () => {
  it("expands a known slug with its arguments", () => {
    const r = expandSlashCommand("/plan dark mode", COMMANDS);
    expect(r).not.toBeNull();
    expect(r?.slug).toBe("plan");
    expect(r?.text).toBe("Research first, then plan: dark mode");
  });

  it("expands a known slug with no args", () => {
    expect(expandSlashCommand("/review", COMMANDS)?.text).toBe(
      "Review this PR.",
    );
  });

  it("returns null for an unknown slug or non-slash input", () => {
    expect(expandSlashCommand("/nope x", COMMANDS)).toBeNull();
    expect(expandSlashCommand("plain message", COMMANDS)).toBeNull();
    expect(expandSlashCommand("/", COMMANDS)).toBeNull();
  });
});

describe("builtin commands", () => {
  it("includes a read-only briefing command", () => {
    const briefing = BUILTIN_COMMANDS.find((c) => c.slug === "briefing");

    expect(briefing).toBeDefined();
    expect(briefing?.body).toContain("work-briefing");
    expect(briefing?.body).toContain("read-only tools");
    expect(briefing?.body).toContain("Do not create, assign, close, edit");
  });
});

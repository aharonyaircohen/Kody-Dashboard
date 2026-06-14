/**
 * Unit tests for saved-macros storage + mapping + chat-format helpers
 * (src/dashboard/lib/macros.ts). Macros let the user save a recorded
 * click-through and either replay it via the inspector extension or
 * hand it to chat as a "do these steps in order" message.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  addMacro,
  formatMacroForChat,
  formatMacrosCatalog,
  readMacros,
  recordedStepToAction,
  removeMacro,
  writeMacros,
  type Macro,
} from "@dashboard/lib/macros";

describe("recordedStepToAction", () => {
  it("maps click", () => {
    expect(
      recordedStepToAction({ type: "click", selector: "#btn", text: "OK" }),
    ).toEqual({ op: "click", selector: "#btn" });
  });
  it("maps fill with explicit value", () => {
    expect(
      recordedStepToAction({
        type: "fill",
        selector: "#email",
        value: "a@b.com",
      }),
    ).toEqual({ op: "fill", selector: "#email", value: "a@b.com" });
  });
  it("maps fill with missing value (treated as empty)", () => {
    expect(recordedStepToAction({ type: "fill", selector: "#x" })).toEqual({
      op: "fill",
      selector: "#x",
      value: "",
    });
  });
  it("returns null when selector is missing", () => {
    expect(
      recordedStepToAction({
        type: "click",
        selector: "",
      } as unknown as { type: "click"; selector: string }),
    ).toBeNull();
  });
});

describe("addMacro / removeMacro", () => {
  it("prepends a new macro (newest first)", () => {
    const existing: Macro[] = [
      { id: "old", name: "Old", createdAt: 1, steps: [] },
    ];
    const next = addMacro(
      existing,
      "New",
      [{ op: "click", selector: "#x" }],
      100,
    );
    expect(next).toHaveLength(2);
    expect(next[0]!.name).toBe("New");
    expect(next[0]!.createdAt).toBe(100);
    expect(next[1]!.name).toBe("Old");
  });
  it("ignores empty names", () => {
    const out = addMacro([], "  ", [{ op: "click", selector: "#x" }], 1);
    expect(out).toEqual([]);
  });
  it("ignores zero-step recordings", () => {
    const out = addMacro([], "name", [], 1);
    expect(out).toEqual([]);
  });
  it("caps long names", () => {
    const long = "a".repeat(200);
    const out = addMacro([], long, [{ op: "click", selector: "#x" }], 1);
    expect(out[0]!.name.length).toBe(64);
  });
  it("removes by id", () => {
    const macros: Macro[] = [
      { id: "a", name: "A", createdAt: 1, steps: [] },
      { id: "b", name: "B", createdAt: 2, steps: [] },
    ];
    expect(removeMacro(macros, "a")).toEqual([macros[1]]);
  });
});

describe("read/writeMacros (localStorage)", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
      },
    };
  });
  it("empty when nothing stored", () => {
    expect(readMacros("o", "r")).toEqual([]);
  });
  it("round-trips and sorts newest first", () => {
    const macros: Macro[] = [
      { id: "1", name: "First", createdAt: 100, steps: [] },
      { id: "2", name: "Second", createdAt: 200, steps: [] },
    ];
    writeMacros("o", "r", macros);
    const out = readMacros("o", "r");
    expect(out[0]!.name).toBe("Second");
    expect(out[1]!.name).toBe("First");
  });
  it("filters malformed entries", () => {
    (
      globalThis as unknown as { window: { localStorage: Storage } }
    ).window.localStorage.setItem(
      "kody.macros.o/r",
      JSON.stringify([
        { id: "good", name: "Good", createdAt: 1, steps: [] },
        { wrong: "shape" },
      ]),
    );
    expect(readMacros("o", "r")).toHaveLength(1);
  });
  it("scopes per-repo", () => {
    writeMacros("o", "a", [{ id: "1", name: "A", createdAt: 1, steps: [] }]);
    writeMacros("o", "b", [{ id: "2", name: "B", createdAt: 1, steps: [] }]);
    expect(readMacros("o", "a")[0]!.name).toBe("A");
    expect(readMacros("o", "b")[0]!.name).toBe("B");
  });
});

describe("formatMacrosCatalog (auto-context entry)", () => {
  it("returns null for empty list — chat context stays clean", () => {
    expect(formatMacrosCatalog([])).toBeNull();
  });
  it("renders each macro's name, count, and inline steps", () => {
    const out = formatMacrosCatalog([
      {
        id: "login",
        name: "Login",
        createdAt: 1,
        steps: [
          { op: "fill", selector: "#email", value: "a@b.com" },
          { op: "click", selector: "#submit" },
        ],
      },
    ])!;
    expect(out).toContain("Login (2 steps)");
    expect(out).toContain("1. fill `#email` = `a@b.com`");
    expect(out).toContain("2. click `#submit`");
    // Header instructs the model what to do with the catalog.
    expect(out).toContain("preview_act");
  });
  it("truncates long step lists with a +N hint", () => {
    const steps = Array.from({ length: 12 }, (_, i) => ({
      op: "click" as const,
      selector: `#btn-${i}`,
    }));
    const out = formatMacrosCatalog([
      { id: "x", name: "Long", createdAt: 1, steps },
    ])!;
    expect(out).toContain("… +4 more");
  });
});

describe("formatMacroForChat", () => {
  it("renders each step in order with instructions for the model", () => {
    const macro: Macro = {
      id: "login",
      name: "Login flow",
      createdAt: 1,
      steps: [
        { op: "fill", selector: "#email", value: "a@b.com" },
        { op: "fill", selector: "#password", value: "secret" },
        { op: "click", selector: "button[type=submit]" },
      ],
    };
    const out = formatMacroForChat(macro);
    expect(out).toContain("Login flow");
    expect(out).toContain("3 steps");
    expect(out).toContain("1. fill `#email` with `a@b.com`");
    expect(out).toContain("2. fill `#password` with `secret`");
    expect(out).toContain("3. click `button[type=submit]`");
    expect(out).toContain("preview_act");
  });
});

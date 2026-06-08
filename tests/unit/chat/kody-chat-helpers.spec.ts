/**
 * Unit tests for KodyChat's pure presentational helpers (extracted from
 * KodyChat.tsx). No window/DOM needed — these are pure functions.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect } from "vitest";
import {
  bootPhaseLabel,
  buildUserTurnParts,
  formatElapsed,
  formatFileSize,
  getFileIcon,
} from "@dashboard/lib/components/kody-chat-helpers";

describe("bootPhaseLabel — Fly timeline", () => {
  it("walks the Fly boot phases by elapsed seconds", () => {
    expect(bootPhaseLabel(0, "fly")).toBe("Spawning Fly machine");
    expect(bootPhaseLabel(11, "fly")).toBe("Spawning Fly machine");
    expect(bootPhaseLabel(12, "fly")).toBe(
      "Cloning repo & warming model proxy",
    );
    expect(bootPhaseLabel(34, "fly")).toBe(
      "Cloning repo & warming model proxy",
    );
    expect(bootPhaseLabel(35, "fly")).toBe("Starting engine");
    expect(bootPhaseLabel(49, "fly")).toBe("Starting engine");
    expect(bootPhaseLabel(50, "fly")).toBe("Almost ready...");
  });
});

describe("bootPhaseLabel — GitHub Actions timeline", () => {
  it("walks the GHA boot phases by elapsed seconds", () => {
    expect(bootPhaseLabel(0, "gh")).toBe("Queueing workflow run");
    expect(bootPhaseLabel(10, "gh")).toBe("Setting up GitHub Actions runner");
    expect(bootPhaseLabel(25, "gh")).toBe("Installing Kody engine");
    expect(bootPhaseLabel(50, "gh")).toBe("Starting LiteLLM proxy");
    expect(bootPhaseLabel(80, "gh")).toBe("Warming up model");
    expect(bootPhaseLabel(110, "gh")).toBe("Almost ready...");
    expect(bootPhaseLabel(999, "gh")).toBe("Almost ready...");
  });
});

describe("formatElapsed", () => {
  it("renders m:ss with zero-padded seconds", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(5)).toBe("0:05");
    expect(formatElapsed(59)).toBe("0:59");
    expect(formatElapsed(60)).toBe("1:00");
    expect(formatElapsed(65)).toBe("1:05");
    expect(formatElapsed(600)).toBe("10:00");
  });
});

describe("formatFileSize", () => {
  it("picks B / KB / MB by magnitude with one decimal", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1023)).toBe("1023 B");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});

describe("getFileIcon", () => {
  it("returns a React element for every mime category", () => {
    for (const mime of [
      "image/png",
      "text/javascript",
      "application/json",
      "text/html",
      "text/css",
      "application/pdf",
      "",
    ]) {
      const el = getFileIcon(mime) as { type?: unknown; props?: unknown };
      expect(el).toBeTruthy();
      expect(el.type).toBeDefined();
      expect(el.props).toBeDefined();
    }
  });
});

describe("buildUserTurnParts", () => {
  it("returns the base message for both display and wire when no extras are attached", () => {
    const { displayContent, wireContent } = buildUserTurnParts({
      baseMessage: "what's going on?",
    });
    expect(displayContent).toBe("what's going on?");
    expect(wireContent).toBe("what's going on?");
  });

  it("hides chip contexts from the visible bubble", () => {
    // Mirrors issue #141: the Preview Inspector chips (picked elements,
    // console errors, failed requests, perf snapshots) should not appear
    // in the chat bubble. The model still receives the full payload.
    const { displayContent, wireContent } = buildUserTurnParts({
      baseMessage: "what's going on?",
      chipContexts: [
        "Picked element: <button#submit>Submit</button>",
        "Console errors (2):\nError: foo\nError: bar",
      ],
    });
    expect(displayContent).toBe("what's going on?");
    expect(wireContent).toBe(
      "what's going on?\n\n" +
        "Picked element: <button#submit>Submit</button>\n\n" +
        "Console errors (2):\nError: foo\nError: bar",
    );
  });

  it("hides the auto-attached preview context from the visible bubble", () => {
    // Mirrors the dc12fa8f split: the model sees the preview page
    // context on the wire; the bubble shows only the typed text.
    const { displayContent, wireContent } = buildUserTurnParts({
      baseMessage: "what's going on?",
      previewContext: "[Dashboard context] the /preview page",
    });
    expect(displayContent).toBe("what's going on?");
    expect(wireContent).toBe(
      "what's going on?\n\n[Dashboard context] the /preview page",
    );
  });

  it("appends chips and preview context to the wire in stable order", () => {
    const { displayContent, wireContent } = buildUserTurnParts({
      baseMessage: "explain",
      chipContexts: ["Picked element: <input>"],
      previewContext: "[Dashboard context] the /preview page",
    });
    expect(displayContent).toBe("explain");
    // Chips ride first (user-attached), then the auto-collected preview
    // context. The order matters because some prompts are sensitive to
    // which block comes first.
    expect(wireContent).toBe(
      "explain\n\nPicked element: <input>\n\n[Dashboard context] the /preview page",
    );
  });

  it("skips blank chip entries", () => {
    const { wireContent } = buildUserTurnParts({
      baseMessage: "explain",
      chipContexts: ["", "  ", "Picked element: <input>"],
    });
    expect(wireContent).toBe("explain\n\nPicked element: <input>");
  });

  it("treats a blank preview context as absent", () => {
    const { displayContent, wireContent } = buildUserTurnParts({
      baseMessage: "explain",
      chipContexts: ["Picked element: <input>"],
      previewContext: "   ",
    });
    expect(displayContent).toBe("explain");
    expect(wireContent).toBe("explain\n\nPicked element: <input>");
  });

  it("is a no-op when chips and preview context are both absent", () => {
    // Without the wire/display split, the existing #140 (preview-context)
    // test for the no-extras path would have regressed. Lock it down.
    const { displayContent, wireContent } = buildUserTurnParts({
      baseMessage: "hi",
      chipContexts: [],
      previewContext: null,
    });
    expect(displayContent).toBe("hi");
    expect(wireContent).toBe("hi");
  });
});

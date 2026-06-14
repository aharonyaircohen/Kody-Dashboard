/**
 * Tests for the speech helpers — focused on `extractSentences`, the pure
 * splitter that powers streaming TTS. It must pull only COMPLETE sentences
 * out of a growing buffer, leave the trailing partial unconsumed (so the
 * caller keeps it until it finishes), and not split mid-number/version.
 */
import { describe, it, expect } from "vitest";
import { extractSentences } from "@dashboard/lib/speech-helpers";

describe("extractSentences", () => {
  it("returns nothing while no sentence is complete", () => {
    const { sentences, consumed } = extractSentences("the build is still");
    expect(sentences).toEqual([]);
    expect(consumed).toBe(0);
  });

  it("extracts a complete sentence and leaves the trailing partial", () => {
    const text = "The deploy is live. Now checking the";
    const { sentences, consumed } = extractSentences(text);
    expect(sentences).toEqual(["The deploy is live."]);
    // The partial "Now checking the" stays unconsumed for the next delta.
    expect(text.slice(consumed)).toBe(" Now checking the");
  });

  it("splits multiple sentences across ., !, and ?", () => {
    const { sentences } = extractSentences("Done! Did it work? Yes it did.");
    expect(sentences).toEqual(["Done!", "Did it work?", "Yes it did."]);
  });

  it("treats newlines as sentence boundaries", () => {
    const { sentences } = extractSentences("First line\nSecond line\n");
    expect(sentences).toEqual(["First line", "Second line"]);
  });

  it("does not split inside version numbers or decimals", () => {
    // "1.26" / "3.5" have no whitespace after the dot → not a boundary.
    const { sentences, consumed } = extractSentences(
      "Pinned to 1.26 and scaled 3.5x",
    );
    expect(sentences).toEqual([]);
    expect(consumed).toBe(0);
  });

  it("splits a version number only at the real sentence end", () => {
    const { sentences } = extractSentences("Pinned to onnx 1.26. Done.");
    expect(sentences).toEqual(["Pinned to onnx 1.26.", "Done."]);
  });

  it("ignores stray punctuation-only fragments", () => {
    const { sentences } = extractSentences("... Hello there.");
    expect(sentences).toEqual(["... Hello there."]);
  });

  it("supports incremental consumption via an advancing pointer", () => {
    // Simulate streaming: the same buffer grows; the caller advances a
    // pointer by `consumed` and only ever re-scans the tail.
    let ptr = 0;
    const spoken: string[] = [];
    for (const full of [
      "Hello world.",
      "Hello world. How are",
      "Hello world. How are you?",
    ]) {
      const { sentences, consumed } = extractSentences(full.slice(ptr));
      ptr += consumed;
      spoken.push(...sentences);
    }
    expect(spoken).toEqual(["Hello world.", "How are you?"]);
  });
});

/**
 * Locks in the vision-vs-text split that decides whether an image is sent as
 * a real image part or inlined as text. The user's two live models are the
 * load-bearing cases: Gemini (vision → real image) and MiniMax (text → inline).
 * Unknown models must fail safe to text-only so we never ship an image_url a
 * text model would reject.
 */
import { describe, expect, it } from "vitest";
import { supportsVision } from "@dashboard/lib/chat/vision-support";

describe("supportsVision", () => {
  const visionModels = [
    // The live case: Gemini in every spelling.
    "gemini-2.5-pro",
    "gemini-1.5-flash",
    "google/gemini-3-pro",
    "GEMINI-2.0-FLASH",
    // Anthropic Claude 3.x / 4.x.
    "claude-3-5-sonnet-20241022",
    "anthropic/claude-sonnet-4",
    "claude-opus-4-8",
    // OpenAI multimodal.
    "gpt-4o",
    "openai/gpt-4.1-mini",
    "gpt-4-turbo",
    "gpt-5",
    "o3",
    "o4-mini",
    // Other multimodal families.
    "mistral/pixtral-12b",
    "meta-llama/llama-3.2-90b-vision-instruct",
    "llama-4-scout",
    "qwen/qwen2.5-vl-7b-instruct",
    "amazon/nova-pro-v1",
    "deepseek-vl-7b-chat",
    // MiniMax M3 family — the current multimodal generation; M2.7 stays
    // text-only (see the regression guard in the textModels block below).
    "minimax/MiniMax-M3",
    "minimax/MiniMax-M3.0",
    "minimax/MiniMax-M3.5-highspeed",
  ];

  const textModels = [
    // The live case: MiniMax in every spelling.
    "minimax/MiniMax-M2.7-highspeed",
    "MiniMax-M2.7-highspeed",
    "minimax-m2",
    // DeepSeek text (NOT the -vl variant).
    "deepseek-chat",
    "deepseek/deepseek-r1",
    "deepseek-v3",
    // Older / text-only OpenAI + others.
    "gpt-3.5-turbo",
    "groq/llama-3.1-70b-versatile",
    "command-r-plus",
    "mistral-large-latest",
    // Garbage / empty must fail safe to text-only.
    "totally-unknown-model",
    "",
  ];

  it.each(visionModels)("treats %s as a vision model", (model) => {
    expect(supportsVision(model)).toBe(true);
  });

  it.each(textModels)("treats %s as a text-only model", (model) => {
    expect(supportsVision(model)).toBe(false);
  });

  it("fails safe on null / undefined", () => {
    expect(supportsVision(null)).toBe(false);
    expect(supportsVision(undefined)).toBe(false);
  });

  it("ignores surrounding whitespace and case", () => {
    expect(supportsVision("  Google/Gemini-2.5-Pro  ")).toBe(true);
    expect(supportsVision("  MiniMax-M2.7-highspeed  ")).toBe(false);
  });
});

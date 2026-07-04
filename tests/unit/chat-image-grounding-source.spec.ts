/**
 * Source-level guards for image-grounded chat turns.
 *
 * @testFramework vitest
 * @domain chat-contract
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const KODY_CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/KodyChat.tsx"),
  "utf8",
);
const KODY_ROUTE_SOURCE = readFileSync(
  resolve(__dirname, "../../app/api/kody/chat/kody/route.ts"),
  "utf8",
);

describe("image-grounded chat turns", () => {
  it("does not append hidden preview context when the current turn has an image", () => {
    expect(KODY_CHAT_SOURCE).toContain("imageTurnHasVisualEvidence");
    expect(KODY_CHAT_SOURCE).toContain('a.mimeType.startsWith("image/")');
    expect(KODY_CHAT_SOURCE).toContain("shouldCollectPreviewContextForTurn");
    expect(KODY_CHAT_SOURCE).toContain(
      "hasImageAttachments: imageTurnHasVisualEvidence",
    );
    expect(KODY_CHAT_SOURCE).toContain(
      "await collectPreviewContextRef.current()\n        : null",
    );
  });

  it("adds a server-side image grounding rule for multimodal turns", () => {
    expect(KODY_ROUTE_SOURCE).toContain("const hasImageParts");
    expect(KODY_ROUTE_SOURCE).toContain("const groundedSystemPrompt");
    expect(KODY_ROUTE_SOURCE).toContain("This turn includes an image");
    expect(KODY_ROUTE_SOURCE).toContain("system: groundedSystemPrompt");
  });
});

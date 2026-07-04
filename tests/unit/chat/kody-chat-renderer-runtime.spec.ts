/**
 * @testFramework vitest
 * @domain chat
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  "src/dashboard/lib/components/KodyChat.tsx",
  "utf8",
);

function renderedViewCardSource(): string {
  const start = SOURCE.indexOf("function RenderedViewCard(");
  const end = SOURCE.indexOf("function checkpointTransportFromChatTransport(");
  return SOURCE.slice(start, end);
}

describe("KodyChat rendered view runtime", () => {
  it("renders generic UI atoms instead of renderer block semantics", () => {
    const source = renderedViewCardSource();

    expect(source).toContain("getRenderedViewUi(view)");
    expect(source).not.toContain("view.blocks.map");
    expect(source).not.toContain('block.type === "selection"');
    expect(source).not.toContain('block.type === "buttons"');
  });
});

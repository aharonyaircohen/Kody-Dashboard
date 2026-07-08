/**
 * @testFramework vitest
 * @domain chat
 */
import { describe, expect, it } from "vitest";
import { softFormatUserMessageForDisplay } from "@dashboard/lib/chat/core/user-message-format";

describe("softFormatUserMessageForDisplay", () => {
  it("splits long plain human text into readable paragraphs", () => {
    const input =
      "please review the checkout flow because users say it feels confusing. make the empty state clearer and check that the action buttons still make sense. keep it simple and do not change the payment logic.";

    expect(softFormatUserMessageForDisplay(input)).toBe(
      [
        "please review the checkout flow because users say it feels confusing.",
        "make the empty state clearer and check that the action buttons still make sense.",
        "keep it simple and do not change the payment logic.",
      ].join("\n\n"),
    );
  });

  it("normalizes common human bullet markers", () => {
    const input = [
      "things to check:",
      "• auth flow",
      "2) checkout copy",
      "3) mobile spacing",
    ].join("\n");

    expect(softFormatUserMessageForDisplay(input)).toBe(
      [
        "things to check:",
        "- auth flow",
        "2. checkout copy",
        "3. mobile spacing",
      ].join("\n"),
    );
  });

  it("leaves fenced code blocks untouched", () => {
    const input = [
      "this is the issue. please inspect it.",
      "```ts",
      "const value={foo:'bar'}",
      "```",
      "then explain the result.",
    ].join("\n");

    expect(softFormatUserMessageForDisplay(input)).toContain(
      "```ts\nconst value={foo:'bar'}\n```",
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  getMessageDirection,
  messageTextDirectionStyle,
} from "@dashboard/lib/chat/surface/MessageList";

describe("message text direction", () => {
  it("uses RTL when the first strong text is Hebrew", () => {
    expect(getMessageDirection("שלום, איך אפשר לעזור?")).toBe("rtl");
  });

  it("skips neutral markdown before detecting RTL text", () => {
    expect(getMessageDirection("> שלום\n\n- בדיקה")).toBe("rtl");
  });

  it("uses plaintext bidi isolation for message text", () => {
    expect(messageTextDirectionStyle).toEqual({ unicodeBidi: "plaintext" });
  });
});

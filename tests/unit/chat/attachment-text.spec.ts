/**
 * Unit tests for plain-text attachment formatting used by chat backends that
 * cannot carry structured image/file parts.
 *
 * @testFramework vitest
 * @domain chat
 */

import { describe, expect, it } from "vitest";
import {
  MAX_TEXT_BACKEND_ATTACHMENT_DATA_CHARS,
  dataUrlForTextAttachment,
  formatAttachmentForTextBackend,
} from "@dashboard/lib/chat/attachment-text";

describe("dataUrlForTextAttachment", () => {
  it("keeps existing data URLs intact", () => {
    expect(dataUrlForTextAttachment("data:image/png;base64,abc")).toBe(
      "data:image/png;base64,abc",
    );
  });

  it("wraps raw base64 in a data URL", () => {
    expect(dataUrlForTextAttachment("abc", "image/jpeg")).toBe(
      "data:image/jpeg;base64,abc",
    );
  });
});

describe("formatAttachmentForTextBackend", () => {
  it("inlines small attachments", () => {
    const out = formatAttachmentForTextBackend({
      kind: "image",
      name: "preview.jpg",
      mimeType: "image/jpeg",
      sizeLabel: "4.0 KB",
      data: "abc",
    });
    expect(out).toContain("[Image: preview.jpg (image/jpeg, 4.0 KB)]");
    expect(out).toContain("data:image/jpeg;base64,abc");
    expect(out).not.toContain("omitted");
  });

  it("omits oversized raw data before it can enter the model context", () => {
    const out = formatAttachmentForTextBackend({
      kind: "image",
      name: "preview.jpg",
      mimeType: "image/jpeg",
      data: "x".repeat(MAX_TEXT_BACKEND_ATTACHMENT_DATA_CHARS + 1),
    });
    expect(out).toContain("[Image: preview.jpg (image/jpeg)]");
    expect(out).toContain("Attachment data omitted");
    expect(out).toContain("context window");
    expect(out).not.toContain("x".repeat(100));
  });
});

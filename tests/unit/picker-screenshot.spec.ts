/**
 * Unit tests for preview screenshot sizing helpers.
 *
 * @testFramework vitest
 * @domain preview-inspector
 */

import { describe, expect, it } from "vitest";
import {
  SCREENSHOT_MAX_EDGE,
  SCREENSHOT_MAX_PIXELS,
  constrainScreenshotSize,
  extensionForMimeType,
  getDataUrlMimeType,
} from "@dashboard/lib/picker/screenshot";

describe("constrainScreenshotSize", () => {
  it("leaves small screenshots unchanged", () => {
    expect(constrainScreenshotSize(640, 360)).toEqual({
      width: 640,
      height: 360,
      scaled: false,
    });
  });

  it("bounds oversized screenshots by edge and total pixels", () => {
    const size = constrainScreenshotSize(3200, 1800);
    expect(size.scaled).toBe(true);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(
      SCREENSHOT_MAX_EDGE,
    );
    expect(size.width * size.height).toBeLessThanOrEqual(
      SCREENSHOT_MAX_PIXELS + SCREENSHOT_MAX_EDGE,
    );
  });
});

describe("screenshot mime helpers", () => {
  it("extracts the data URL mime type", () => {
    expect(getDataUrlMimeType("data:image/jpeg;base64,abc")).toBe("image/jpeg");
  });

  it("falls back for non-data values", () => {
    expect(getDataUrlMimeType("abc")).toBe("application/octet-stream");
  });

  it("maps common image mime types to extensions", () => {
    expect(extensionForMimeType("image/jpeg")).toBe("jpg");
    expect(extensionForMimeType("image/png")).toBe("png");
    expect(extensionForMimeType("image/webp")).toBe("webp");
  });
});

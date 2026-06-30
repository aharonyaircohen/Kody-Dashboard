import { describe, expect, it } from "vitest";

import {
  carryPreviewAuthParams,
  hasPreviewAuthParams,
  rebasePreviewAuthUrl,
  stripPreviewAuthParams,
} from "@dashboard/lib/preview-auth-url";

describe("preview auth URL helpers", () => {
  it("keeps the ticket on clean same-origin Fly URLs learned from the iframe", () => {
    expect(
      carryPreviewAuthParams(
        "https://kp-test.fly.dev/?kp=old-ticket",
        "https://kp-test.fly.dev/start?locale=he#top",
      ),
    ).toBe("https://kp-test.fly.dev/start?locale=he&kp=old-ticket#top");
  });

  it("does not copy a ticket across preview origins", () => {
    expect(
      carryPreviewAuthParams(
        "https://kp-one.fly.dev/?kp=old-ticket",
        "https://kp-two.fly.dev/start",
      ),
    ).toBe("https://kp-two.fly.dev/start");
  });

  it("removes the ticket from visible preview addresses", () => {
    expect(
      stripPreviewAuthParams(
        "https://kp-test.fly.dev/start?locale=he&kp=secret#top",
      ),
    ).toBe("https://kp-test.fly.dev/start?locale=he#top");
  });

  it("removes Vercel bypass params from visible preview addresses", () => {
    expect(
      stripPreviewAuthParams(
        "https://example.vercel.app/start?x-vercel-protection-bypass=secret&locale=he&x-vercel-set-bypass-cookie=samesitenone#top",
      ),
    ).toBe("https://example.vercel.app/start?locale=he#top");
  });

  it("detects protected Fly preview URLs", () => {
    expect(hasPreviewAuthParams("https://kp-test.fly.dev/?kp=secret")).toBe(
      true,
    );
    expect(hasPreviewAuthParams("https://kp-test.fly.dev/")).toBe(false);
    expect(hasPreviewAuthParams("https://example.com/?kp=secret")).toBe(false);
  });

  it("uses a fresh ticket while preserving the current preview path", () => {
    expect(
      rebasePreviewAuthUrl(
        "https://kp-test.fly.dev/start?locale=he&kp=old-ticket#top",
        "https://kp-test.fly.dev/?kp=fresh-ticket",
      ),
    ).toBe("https://kp-test.fly.dev/start?locale=he&kp=fresh-ticket#top");
  });

  it("does not rewrite same-origin non-Fly refreshes", () => {
    expect(
      rebasePreviewAuthUrl(
        "https://example.vercel.app/start?locale=he",
        "https://example.vercel.app/",
      ),
    ).toBeNull();
  });

  it("leaves non-Fly preview URLs visible and unchanged", () => {
    expect(
      stripPreviewAuthParams("https://example.vercel.app/?kp=not-ours"),
    ).toBe("https://example.vercel.app/?kp=not-ours");
  });
});

/**
 * @fileoverview Brain target resolution tests.
 * @testFramework vitest
 * @domain brain
 */

import { describe, expect, it } from "vitest";

import { resolveBrainTarget } from "@dashboard/lib/brain/target";

describe("resolveBrainTarget", () => {
  it("uses the stored app and stored org together", () => {
    expect(
      resolveBrainTarget({
        account: "alice",
        contextOrgSlug: "personal",
        stored: {
          version: 1,
          appName: "brain-1",
          orgSlug: "guy-koren",
          createdAt: "2026-06-29T20:57:37.213Z",
        },
      }),
    ).toEqual({
      app: "brain-1",
      orgSlug: "guy-koren",
      source: "stored",
    });
  });

  it("keeps the stored org when an explicit override matches the stored app", () => {
    expect(
      resolveBrainTarget({
        account: "alice",
        contextOrgSlug: "personal",
        appNameOverride: "brain-1",
        stored: {
          version: 1,
          appName: "brain-1",
          orgSlug: "guy-koren",
          createdAt: "2026-06-29T20:57:37.213Z",
        },
      }),
    ).toMatchObject({ app: "brain-1", orgSlug: "guy-koren" });
  });

  it("uses the context org for a different explicit override", () => {
    expect(
      resolveBrainTarget({
        account: "alice",
        contextOrgSlug: "personal",
        appNameOverride: "other-brain",
        stored: {
          version: 1,
          appName: "brain-1",
          orgSlug: "guy-koren",
          createdAt: "2026-06-29T20:57:37.213Z",
        },
      }),
    ).toMatchObject({ app: "other-brain", orgSlug: "personal" });
  });

  it("falls back to the derived app in the context org", () => {
    expect(
      resolveBrainTarget({
        account: "Alice.Example",
        contextOrgSlug: "personal",
        stored: null,
      }),
    ).toEqual({
      app: "kody-brain-alice-example",
      orgSlug: "personal",
      source: "default",
    });
  });
});

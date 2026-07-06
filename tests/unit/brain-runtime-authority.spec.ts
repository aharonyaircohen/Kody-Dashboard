/**
 * @fileoverview Unit coverage for Brain runtime authority drift decisions.
 * @testFramework vitest
 * @domain brain
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  brainRuntimeDrift,
  type BrainRuntimeAuthorityView,
} from "../../src/dashboard/lib/brain/runtime-authority";

describe("Brain runtime authority", () => {
  it("flags completed apply records that do not include a running machine", () => {
    const runtime: BrainRuntimeAuthorityView["runtime"] = {
      desiredImageRef: "ghcr.io/acme/kody-brain-octocat:20260703t052814z",
      operation: {
        id: "op-1",
        type: "apply-image",
        status: "completed",
        imageRef: "ghcr.io/acme/kody-brain-octocat:20260703t052814z",
        startedAt: "2026-07-03T05:37:07.716Z",
        updatedAt: "2026-07-03T05:38:53.523Z",
      },
      source: "runtime",
    };

    expect(brainRuntimeDrift(runtime, null)).toMatchObject({
      code: "completed_apply_missing_running",
      desiredImageRef: "ghcr.io/acme/kody-brain-octocat:20260703t052814z",
      runningImageRef: null,
    });
  });

  it("accepts equivalent GHCR and Fly runtime tags for the live machine", () => {
    expect(
      brainRuntimeDrift(
        {
          desiredImageRef: "ghcr.io/acme/kody-brain-octocat:20260703t052814z",
          runningImageRef: "ghcr.io/acme/kody-brain-octocat:20260703t052814z",
          source: "runtime",
        },
        {
          imageRef: "registry.fly.io/brain-1:20260703t052814z",
          state: "running",
        },
      ),
    ).toBeNull();
  });

  it("flags selected images that differ from the running image", () => {
    expect(
      brainRuntimeDrift(
        {
          desiredImageRef: "ghcr.io/acme/kody-brain-octocat:new",
          runningImageRef: "ghcr.io/acme/kody-brain-octocat:old",
          source: "runtime",
        },
        null,
      ),
    ).toMatchObject({
      code: "selected_image_not_running",
      desiredImageRef: "ghcr.io/acme/kody-brain-octocat:new",
      runningImageRef: "ghcr.io/acme/kody-brain-octocat:old",
    });
  });
});

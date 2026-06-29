/**
 * @fileoverview Unit coverage for Brain image save helpers.
 * @testFramework vitest
 * @domain brain
 */
import { describe, expect, it } from "vitest";

import {
  brainFlyImageRef,
  brainImageBuildCommand,
  brainImageTag,
} from "@dashboard/lib/brain/image-save";

describe("Brain image save helpers", () => {
  it("builds Fly registry image refs for the Brain app", () => {
    const tag = brainImageTag(new Date("2026-06-25T10:20:30.000Z"));

    expect(tag).toBe("20260625t102030z");
    expect(brainFlyImageRef("kody-brain-alice", tag)).toBe(
      "registry.fly.io/kody-brain-alice:20260625t102030z",
    );
  });

  it("builds a bridge command that exports state and pushes without deploying", () => {
    const command = brainImageBuildCommand({
      app: "kody-brain-alice",
      machineId: "machine-1",
      tag: "20260625t102030z",
      baseImageRef: "ghcr.io/aharonyaircohen/kody-brain:latest",
    });

    expect(command).toContain("flyctl ssh console");
    expect(command).toContain("--build-only");
    expect(command).toContain("--push");
    expect(command).toContain("registry.fly.io/kody-brain-alice");
    expect(command).toContain("__KODY_BRAIN_IMAGE_REF=");
    expect(command).toContain('> "$tmpdir/build.log" 2>&1');
    expect(command).toContain('tail -n 200 "$tmpdir/build.log"');
  });
});

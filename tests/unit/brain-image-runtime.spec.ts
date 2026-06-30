/**
 * @fileoverview Unit coverage for Brain image runtime restore helpers.
 * @testFramework vitest
 * @domain brain
 */
import { describe, expect, it } from "vitest";

import {
  brainFlyRuntimeImageRef,
  brainGhcrAuth,
  brainImageRestoreCommand,
} from "@dashboard/lib/brain/image-runtime";

describe("Brain image runtime helpers", () => {
  it("derives the per-app Fly runtime image from the saved GHCR tag", () => {
    expect(
      brainFlyRuntimeImageRef({
        app: "kody-brain-alice",
        imageRef: "ghcr.io/a-guy-educ/kody-brain-alice:20260625t102030z",
      }),
    ).toBe("registry.fly.io/kody-brain-alice:20260625t102030z");
  });

  it("prefers explicit GHCR vault auth over the request token", () => {
    expect(
      brainGhcrAuth({
        allSecrets: {
          GHCR_TOKEN: "ghcr-token",
          GHCR_USER: "package-owner",
          GITHUB_TOKEN: "vault-github-token",
        },
        githubToken: "request-token",
        account: "alice",
      }),
    ).toEqual({ token: "ghcr-token", user: "package-owner" });
  });

  it("falls back to vault GitHub token and then request token", () => {
    expect(
      brainGhcrAuth({
        allSecrets: { GITHUB_TOKEN: "vault-github-token" },
        githubToken: "request-token",
        account: "alice",
      }),
    ).toEqual({ token: "vault-github-token", user: "alice" });

    expect(
      brainGhcrAuth({
        allSecrets: {},
        githubToken: "request-token",
        account: "alice",
      }),
    ).toEqual({ token: "request-token", user: "alice" });
  });

  it("builds a restore command that mirrors GHCR into Fly registry", () => {
    const command = brainImageRestoreCommand({
      sourceImageRef: "ghcr.io/a-guy-educ/kody-brain-alice:20260625t102030z",
      runtimeImageRef: "registry.fly.io/kody-brain-alice:20260625t102030z",
      ghcrUser: "alice",
    });

    expect(command).toContain("skopeo login ghcr.io");
    expect(command).toContain("flyctl auth docker");
    expect(command).toContain("skopeo copy --all");
    expect(command).toContain(
      '"docker://$source_image" "docker://$runtime_image"',
    );
    expect(command).toContain("__KODY_BRAIN_RUNTIME_IMAGE_REF=");
  });

  it("rejects non-GHCR durable sources", () => {
    expect(() =>
      brainImageRestoreCommand({
        sourceImageRef: "registry.fly.io/kody-brain-alice:20260625t102030z",
        runtimeImageRef: "registry.fly.io/kody-brain-alice:20260625t102030z",
        ghcrUser: "alice",
      }),
    ).toThrow("Invalid Brain GHCR image ref");
  });
});

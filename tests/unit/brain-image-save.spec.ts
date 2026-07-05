/**
 * @fileoverview Unit coverage for Brain image save helpers.
 * @testFramework vitest
 * @domain brain
 */
import { describe, expect, it } from "vitest";

import {
  brainGhcrImageRef,
  brainImageBuildCommand,
  brainImageSaveProgressFromOutput,
  brainImageTag,
} from "@dashboard/lib/brain/image-save";

describe("Brain image save helpers", () => {
  it("builds GHCR image refs for the saved Brain image", () => {
    const tag = brainImageTag(new Date("2026-06-25T10:20:30.000Z"));

    expect(tag).toBe("20260625t102030z");
    expect(
      brainGhcrImageRef({
        owner: "A-Guy-educ",
        account: "Alice",
        tag,
      }),
    ).toBe("ghcr.io/a-guy-educ/kody-brain-alice:20260625t102030z");
  });

  it("builds a command that archives the Brain filesystem and pushes GHCR", () => {
    const command = brainImageBuildCommand({
      app: "kody-brain-alice",
      machineId: "machine-1",
      orgSlug: "guy-koren",
      tag: "20260625t102030z",
      baseImageRef: "ghcr.io/aharonyaircohen/kody-brain:latest",
      imageRef: "ghcr.io/a-guy-educ/kody-brain-alice:20260625t102030z",
      ghcrUser: "Alice",
    });

    expect(command).toContain("flyctl ssh console");
    expect(command).toContain("flyctl ssh sftp put");
    expect(command).toContain("keep_brain_awake");
    expect(command).toContain("https://$app.fly.dev/healthz");
    expect(command).toContain('kill "$keepalive_pid"');
    expect(command).toContain('archive="${1:?archive}"');
    expect(command).toContain(
      '--command "/bin/bash $remote_script $remote_archive"',
    );
    expect(command).toContain("tar -C /");
    expect(command).toContain("--one-file-system");
    expect(command).toContain("flyctl sftp get");
    expect(command).toContain("retry()");
    expect(command).toContain('retry "download-rootfs" flyctl sftp get');
    expect(command).toContain("__KODY_BRAIN_SAVE_STAGE=download-rootfs");
    expect(command).toContain("__KODY_BRAIN_SAVE_RETRY=");
    expect(command).toContain("install_crane");
    expect(command).toContain("crane auth login ghcr.io");
    expect(command).toContain("crane append --base");
    expect(command).toContain('retry "push-ghcr" crane append');
    expect(command).toContain('--new_layer "$tmpdir/rootfs.tgz"');
    expect(command).toContain('--new_tag "$image"');
    expect(command).toContain("ghcr.io/a-guy-educ/kody-brain-alice");
    expect(command).toContain("__KODY_BRAIN_IMAGE_REF=");
    expect(command).not.toContain("root-state");
    expect(command).not.toContain("apt-manual.txt");
    expect(command).not.toContain("--depot=false");
    expect(command).not.toContain("KODY_BRAIN_ARCHIVE=");
    expect(command).not.toContain("flyctl deploy");
  });

  it("does not depend on a transient Fly registry tag", () => {
    const command = brainImageBuildCommand({
      app: "kody-brain-alice",
      machineId: "machine-1",
      orgSlug: "guy-koren",
      tag: "20260625t102030z",
      baseImageRef: "ghcr.io/aharonyaircohen/kody-brain:latest",
      imageRef: "ghcr.io/a-guy-educ/kody-brain-alice:20260625t102030z",
      ghcrUser: "Alice",
    });

    expect(command).not.toContain('fly_image="registry.fly.io/$app:$tag"');
    expect(command).not.toContain('"docker://$fly_image" "docker://$image"');
    expect(command).not.toContain("--image-label");
    expect(command).toContain("__KODY_BRAIN_IMAGE_REF=%s");
  });

  it("requires a GHCR token in the bridge environment", () => {
    const command = brainImageBuildCommand({
      app: "kody-brain-alice",
      machineId: "machine-1",
      orgSlug: "guy-koren",
      tag: "20260625t102030z",
      baseImageRef: "ghcr.io/aharonyaircohen/kody-brain:latest",
      imageRef: "ghcr.io/a-guy-educ/kody-brain-alice:20260625t102030z",
      ghcrUser: "Alice",
    });

    expect(command).toContain("GHCR_TOKEN missing");
    expect(command).toContain("crane auth login ghcr.io");
    expect(command).toContain("--password-stdin");
  });

  it("scopes every Fly SSH/SFTP operation to the resolved Brain org", () => {
    const command = brainImageBuildCommand({
      app: "brain-1",
      machineId: "machine-1",
      orgSlug: "guy-koren",
      tag: "20260625t102030z",
      baseImageRef: "ghcr.io/aharonyaircohen/kody-brain:latest",
      imageRef: "ghcr.io/a-guy-educ/kody-brain-alice:20260625t102030z",
      ghcrUser: "Alice",
    } as Parameters<typeof brainImageBuildCommand>[0] & {
      orgSlug: string;
    });

    expect(command).toContain("org=");
    expect(command).toContain("guy-koren");
    expect(command).toContain('--org "$org"');
    expect(command.match(/flyctl /g)?.length).toBe(4);
    expect(command.match(/--org "\$org"/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects non-GHCR saved image refs", () => {
    expect(() =>
      brainImageBuildCommand({
        app: "kody-brain-alice",
        machineId: "machine-1",
        orgSlug: "guy-koren",
        tag: "20260625t102030z",
        baseImageRef: "ghcr.io/aharonyaircohen/kody-brain:latest",
        imageRef: "registry.fly.io/kody-brain-alice:20260625t102030z",
        ghcrUser: "Alice",
      }),
    ).toThrow("Invalid Brain GHCR image ref");
  });

  it("rejects unsafe tags used in archive paths", () => {
    expect(() =>
      brainImageBuildCommand({
        app: "kody-brain-alice",
        machineId: "machine-1",
        orgSlug: "guy-koren",
        tag: "../../bad",
        baseImageRef: "ghcr.io/aharonyaircohen/kody-brain:latest",
        imageRef: "ghcr.io/a-guy-educ/kody-brain-alice:20260625t102030z",
        ghcrUser: "Alice",
      }),
    ).toThrow("Invalid Brain image tag");
  });

  it("reports truthful phase progress from bridge job output", () => {
    expect(
      brainImageSaveProgressFromOutput({
        status: "running",
        stdout: "__KODY_BRAIN_SAVE_STAGE=export-rootfs\n",
        stderr: "",
        error: null,
      }),
    ).toMatchObject({
      phase: "exporting-rootfs",
      message: "Exporting the Brain filesystem",
    });

    expect(
      brainImageSaveProgressFromOutput({
        status: "running",
        stdout:
          "__KODY_BRAIN_SAVE_STAGE=push-ghcr\n__KODY_BRAIN_SAVE_RETRY=push-ghcr:1\n",
        stderr: "upload stalled once\n",
        error: null,
      }),
    ).toMatchObject({
      phase: "pushing-image",
      message: "Retrying push ghcr",
      lastOutput: "upload stalled once",
    });
  });
});

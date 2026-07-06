/**
 * @fileoverview Source-level guard for Brain Images manager mutation refreshes.
 * @testFramework vitest
 * @domain brain
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/BrainImagesManager.tsx"),
  "utf8",
);

describe("BrainImagesManager", () => {
  it("reloads authoritative image state after each mutating action", () => {
    expect(SOURCE).toContain("await loadImages();");
    expect(SOURCE).toContain('toast.success("Brain image applied");');
    expect(SOURCE).toContain(
      'await loadImages();\n      toast.success("Brain image forgotten");',
    );
  });

  it("requires confirmation before forgetting an image", () => {
    expect(SOURCE).toContain('import { ConfirmDialog } from "./ConfirmDialog";');
    expect(SOURCE).toContain("const [pendingForgetRef, setPendingForgetRef]");
    expect(SOURCE).toContain(
      "onClick={() => setPendingForgetRef(image.imageRef)}",
    );
    expect(SOURCE).toContain("<ConfirmDialog");
    expect(SOURCE).toContain('confirmLabel="Forget"');
    expect(SOURCE).toContain("variant=\"destructive\"");
    expect(SOURCE).toContain(
      "if (pendingForgetRef) void forgetImage(pendingForgetRef);",
    );
  });

  it("requires confirmation before replacing the running Brain image", () => {
    expect(SOURCE).toContain("const [pendingApplyRef, setPendingApplyRef]");
    expect(SOURCE).toContain("requestApplyImage(image.imageRef)");
    expect(SOURCE).toContain("This will replace the Brain machine image");
    expect(SOURCE).toContain("Unsaved changes in the current machine may be lost");
    expect(SOURCE).toContain('confirmLabel="Run image"');
    expect(SOURCE).toContain(
      "if (pendingApplyRef) void applyImage(pendingApplyRef);",
    );
  });

  it("refreshes terminal machine targets after applying an image", () => {
    expect(SOURCE).toContain(
      'window.dispatchEvent(new Event("kody:fly-machines-refresh"));',
    );
  });

  it("runs the clicked image as the only image activation action", () => {
    expect(SOURCE).toContain('body: JSON.stringify({ imageRef }),');
    expect(SOURCE).toContain('headers: { "content-type": "application/json", ...headers },');
    expect(SOURCE).toContain("Run this image");
    expect(SOURCE).toContain("Running Brain image");
    expect(SOURCE).toContain("disabled={running || busy}");
    expect(SOURCE).not.toContain("selectImage(");
    expect(SOURCE).not.toContain('toast.success("Brain image selected")');
    expect(SOURCE).not.toContain("disabled={!selected || running || busy}");
  });

  it("shows running Brain image, latest save, and saved image count separately", () => {
    expect(SOURCE).toContain("Run this image replaces the saved Brain machine image");
    expect(SOURCE).toContain("Running Brain image");
    expect(SOURCE).toContain("Latest save");
    expect(SOURCE).toContain("Saved images");
    expect(SOURCE).not.toContain(">Selected<");
    expect(SOURCE).not.toContain(">Running<");
    expect(SOURCE).toContain("Pending image");
    expect(SOURCE).toContain('Machine {machineState ?? "state unknown"}');
    expect(SOURCE).toContain("machineImageRef");
    expect(SOURCE).toContain("Saved {formatDate(image.updatedAt)}");
    expect(SOURCE).toContain("`Applied ${formatDate(runningAt)}`");
  });

  it("lets users edit a human label and note without changing the GHCR ref", () => {
    expect(SOURCE).toContain("const [editingRef, setEditingRef]");
    expect(SOURCE).toContain("const [draftLabel, setDraftLabel]");
    expect(SOURCE).toContain("const [draftNote, setDraftNote]");
    expect(SOURCE).toContain("saveImageMetadata");
    expect(SOURCE).toContain('method: "PATCH"');
    expect(SOURCE).toContain("label: draftLabel");
    expect(SOURCE).toContain("note: draftNote");
    expect(SOURCE).toContain("imageTitle(image)");
    expect(SOURCE).toContain("{image.note &&");
    expect(SOURCE).toContain("Edit label and note");
  });

  it("shows restore status from the runtime operation", () => {
    expect(SOURCE).toContain("runtime?: BrainRuntimeState | null;");
    expect(SOURCE).toContain("restoreOperation");
    expect(SOURCE).toContain("Last restore");
    expect(SOURCE).toContain("Restore failed");
    expect(SOURCE).toContain("Restore succeeded");
  });
});

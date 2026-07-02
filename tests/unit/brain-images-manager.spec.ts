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
  resolve(
    __dirname,
    "../../src/dashboard/lib/components/BrainImagesManager.tsx",
  ),
  "utf8",
);

describe("BrainImagesManager", () => {
  it("reloads authoritative image state after each mutating action", () => {
    expect(SOURCE).toContain(
      'await loadImages();\n      toast.success("Brain image selected");',
    );
    expect(SOURCE).toContain("await loadImages();");
    expect(SOURCE).toContain('toast.success("Brain image applied");');
    expect(SOURCE).toContain(
      'await loadImages();\n      toast.success("Brain image forgotten");',
    );
  });

  it("requires confirmation before forgetting an image", () => {
    expect(SOURCE).toContain(
      'import { ConfirmDialog } from "./ConfirmDialog";',
    );
    expect(SOURCE).toContain("const [pendingForgetRef, setPendingForgetRef]");
    expect(SOURCE).toContain(
      "onClick={() => setPendingForgetRef(image.imageRef)}",
    );
    expect(SOURCE).toContain("<ConfirmDialog");
    expect(SOURCE).toContain('confirmLabel="Forget"');
    expect(SOURCE).toContain('variant="destructive"');
    expect(SOURCE).toContain(
      "if (pendingForgetRef) void forgetImage(pendingForgetRef);",
    );
  });

  it("refreshes terminal machine targets after applying an image", () => {
    expect(SOURCE).toContain(
      'window.dispatchEvent(new Event("kody:fly-machines-refresh"));',
    );
  });

  it("applies the clicked image row without requiring prior selection", () => {
    expect(SOURCE).toContain("body: JSON.stringify({ imageRef }),");
    expect(SOURCE).toContain(
      'headers: { "content-type": "application/json", ...headers },',
    );
    expect(SOURCE).toContain("disabled={running || busy}");
    expect(SOURCE).not.toContain("disabled={!selected || running || busy}");
  });
});

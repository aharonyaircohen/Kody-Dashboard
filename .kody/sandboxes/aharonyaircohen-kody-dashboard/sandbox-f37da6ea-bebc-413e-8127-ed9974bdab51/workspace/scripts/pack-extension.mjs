#!/usr/bin/env node
/**
 * Packs extension/ into public/kody-element-picker.zip so the dashboard can
 * serve it as a static download (the "Get picker" button). Run after changing
 * anything under extension/, then commit the regenerated zip.
 *
 * The zip's contents are the *contents* of extension/ (manifest.json at the
 * root), so after a user unzips it the folder is directly loadable via
 * chrome://extensions → "Load unpacked".
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(root, "extension");
const outDir = join(root, "public");
const outFile = join(outDir, "kody-element-picker.zip");

if (!existsSync(join(extensionDir, "manifest.json"))) {
  console.error("✗ extension/manifest.json not found — nothing to pack.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
rmSync(outFile, { force: true }); // zip appends; start clean for reproducibility

try {
  // -r recurse, -q quiet, -X drop extra file attributes, exclude junk files.
  execFileSync(
    "zip",
    ["-rqX", outFile, ".", "-x", "*.DS_Store", "-x", "__MACOSX*"],
    { cwd: extensionDir, stdio: "inherit" },
  );
} catch (err) {
  console.error(
    "✗ Failed to run `zip`. Install it (preinstalled on macOS/Linux) and retry.",
  );
  console.error(err.message);
  process.exit(1);
}

console.log(`✓ Packed extension → ${outFile.replace(`${root}/`, "")}`);

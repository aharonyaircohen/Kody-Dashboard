#!/usr/bin/env node
/**
 * Packs extension/ into browser-specific downloads so dashboard can serve the
 * right static file from the "Get inspector" button. Run after changing
 * anything under extension/, then commit regenerated zips.
 *
 * zip contents keep manifest.json at root, so after user unzips the folder it
 * is directly loadable from browser extension tools.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(root, "extension");
const outDir = join(root, "public");
const chromeOutFile = join(outDir, "kody-element-picker.zip");
const firefoxOutFile = join(outDir, "kody-preview-inspector-firefox.zip");
const firefoxManifest = join(extensionDir, "manifest.firefox.json");

if (!existsSync(join(extensionDir, "manifest.json"))) {
  console.error("✗ extension/manifest.json not found - nothing to pack.");
  process.exit(1);
}

if (!existsSync(firefoxManifest)) {
  console.error(
    "✗ extension/manifest.firefox.json not found - nothing to pack.",
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

function pack(sourceDir, outFile, extraZipArgs = []) {
  rmSync(outFile, { force: true }); // zip appends; start clean for reproducibility.

  // -r recurse, -q quiet, -X drop extra file attributes, exclude junk files.
  execFileSync(
    "zip",
    [
      "-rqX",
      outFile,
      ".",
      "-x",
      "*.DS_Store",
      "-x",
      "__MACOSX*",
      ...extraZipArgs,
    ],
    { cwd: sourceDir, stdio: "inherit" },
  );
}

let firefoxTempDir;

try {
  pack(extensionDir, chromeOutFile, ["-x", "manifest.firefox.json"]);

  firefoxTempDir = mkdtempSync(join(tmpdir(), "kody-preview-inspector-"));
  cpSync(join(extensionDir, "src"), join(firefoxTempDir, "src"), {
    recursive: true,
  });
  copyFileSync(
    join(extensionDir, "README.md"),
    join(firefoxTempDir, "README.md"),
  );
  copyFileSync(firefoxManifest, join(firefoxTempDir, "manifest.json"));
  pack(firefoxTempDir, firefoxOutFile);
} catch (err) {
  console.error(
    "✗ Failed to run `zip`. Install it (preinstalled on macOS/Linux) and retry.",
  );
  console.error(err.message);
  process.exit(1);
} finally {
  if (firefoxTempDir) rmSync(firefoxTempDir, { recursive: true, force: true });
}

console.log(
  `✓ Packed Chrome extension -> ${chromeOutFile.replace(`${root}/`, "")}`,
);
console.log(
  `✓ Packed Firefox extension -> ${firefoxOutFile.replace(`${root}/`, "")}`,
);

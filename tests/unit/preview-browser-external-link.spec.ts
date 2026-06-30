/**
 * @testFramework vitest
 * @domain preview
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PREVIEW_BROWSER_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/PreviewBrowser.tsx",
);

const SOURCE = readFileSync(PREVIEW_BROWSER_PATH, "utf8");

describe("PreviewBrowser new-tab action", () => {
  it("renders an external-link icon that opens the iframe-ready preview URL", () => {
    expect(SOURCE).toMatch(/ExternalLink,?[\s\S]*from "lucide-react"/);
    expect(SOURCE).toMatch(
      /href=\{externalPreviewUrl\s*\?\?\s*activePreviewUrl\}[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"[\s\S]*aria-label="Open preview in a new tab"[\s\S]*<ExternalLink/,
    );
  });

  it("does not push auth-only URL changes into preview history", () => {
    expect(SOURCE).toMatch(
      /function sameBrowserAddress[\s\S]*stripPreviewAuthParams\(left,[\s\S]*stripPreviewAuthParams\(right,/,
    );
  });

  it("keeps observed iframe URLs from remounting the iframe", () => {
    expect(SOURCE).toMatch(
      /const \[iframeSourceUrl,\s*setIframeSourceUrl\] = useState/,
    );
    expect(SOURCE).toMatch(
      /const iframeLoadUrl = iframeSourceUrl \?\? previewUrl/,
    );
    expect(SOURCE).toMatch(/src=\{iframeBypassedUrl \?\? undefined\}/);

    const syncBlock = SOURCE.match(
      /const syncBrowserHistoryUrl = useCallback\([\s\S]*?\n  \);/,
    );
    expect(syncBlock).not.toBeNull();
    expect(syncBlock![0]).toContain("setBrowserHistory");
    expect(syncBlock![0]).not.toContain("setIframeSourceUrl");
  });

  it("only explicit browser commands update the iframe load source", () => {
    expect(SOURCE).toContain("setIframeSourceUrl(nextUrl)");
    expect(SOURCE).toContain("setIframeSourceUrl(authedNextUrl)");
    expect(SOURCE).toContain("setIframeSourceUrl(nextRefreshSourceUrl)");
  });
});

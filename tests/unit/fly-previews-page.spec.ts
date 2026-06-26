/**
 * Source-level structural tests for the Fly Previews page.
 *
 * The dashboard runs component tests in node mode, so these pin the page and
 * composition contracts without needing a browser DOM.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const PAGE_PATH = resolve(ROOT, "app/(chat-rail)/fly/previews/page.tsx");
const RUNNER_MANAGER_PATH = resolve(
  ROOT,
  "src/dashboard/lib/components/RunnerManager.tsx",
);
const PREVIEWS_LIST_PATH = resolve(
  ROOT,
  "src/dashboard/lib/components/FlyPreviewsList.tsx",
);

describe("Fly Previews page", () => {
  it("has a dedicated /fly/previews page wired to RunnerManager", () => {
    expect(existsSync(PAGE_PATH)).toBe(true);
    const source = readFileSync(PAGE_PATH, "utf8");
    expect(source).toMatch(/title:\s*"Fly Previews/);
    expect(source).toMatch(/path:\s*"\/fly\/previews"/);
    expect(source).toMatch(/<RunnerManager view="previews" \/>/);
  });

  it("moves PR preview controls from Config into the Previews view", () => {
    const source = readFileSync(RUNNER_MANAGER_PATH, "utf8");
    expect(source).toMatch(/export type RunnerView = .*"previews"/s);
    expect(source).toMatch(/view === "previews"/);
    expect(source).toMatch(/<FlyPreviewsList/);
    expect(source).toMatch(/<PreviewsCard/);

    const previewsBlock = source.match(
      /function FlyPreviewsView[\s\S]*?export function RunnerManager/,
    );
    expect(previewsBlock).not.toBeNull();
    expect(previewsBlock![0].indexOf("<PreviewsCard")).toBeGreaterThan(-1);
    expect(previewsBlock![0].indexOf("<FlyPreviewsList")).toBeGreaterThan(-1);
    expect(previewsBlock![0].indexOf("<PreviewsCard")).toBeLessThan(
      previewsBlock![0].indexOf("<FlyPreviewsList"),
    );

    const configBlock = source.match(
      /function RunnerConfigView[\s\S]*?function FlyPreviewsView/,
    );
    expect(configBlock).not.toBeNull();
    expect(configBlock![0]).not.toMatch(/<PreviewsCard/);
  });

  it("lists live preview machine details with copy/open icon actions", () => {
    expect(existsSync(PREVIEWS_LIST_PATH)).toBe(true);
    const source = readFileSync(PREVIEWS_LIST_PATH, "utf8");
    expect(source).toMatch(/\/api\/kody\/fly\/machines/);
    expect(source).toMatch(/\/api\/kody\/previews\/ticket/);
    expect(source).toMatch(/feature === "preview"/);
    expect(source).toMatch(/previewUrl/);
    expect(source).toMatch(/signedPreviewUrl/);
    expect(source).toMatch(/machineId/);
    expect(source).toMatch(/sizeLabel/);
    expect(source).toMatch(/region/);
    expect(source).toMatch(/createdAt/);
    expect(source).toMatch(/title="Copy preview URL"/);
    expect(source).toMatch(/aria-label="Copy preview URL"/);
    expect(source).toMatch(/title="Open preview"/);
    expect(source).toMatch(/aria-label="Open preview"/);
    expect(source).toMatch(/window\.open/);
    expect(source).toMatch(/flex-wrap/);
    expect(source).toMatch(/<ul/);
    expect(source).toMatch(/auto-fit/);
    expect(source).toMatch(/min\(100%,18rem\)/);
    expect(source).toMatch(/<dl/);
    expect(source).toMatch(/space-y-2 text-\[11px\]/);
    expect(source).not.toMatch(/divide-y/);
    expect(source).not.toMatch(/lg:grid-cols-\[/);
    expect(source).not.toMatch(/break-all/);
    expect(source).toMatch(/statePill/);
    expect(source).toMatch(/shortId/);
    expect(source).not.toMatch(/<span>Open<\/span>/);
    expect(source).not.toMatch(
      /className="block font-mono text-\[11px\] text-sky-300/,
    );
  });
});

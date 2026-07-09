/**
 * Source-level guard for the hot task-list route's GitHub budget.
 *
 * The route is polled by several dashboard surfaces. Fetching kodyState calls
 * fetchComments(), so it must stay limited to live work instead of every
 * historical `kody:*` issue.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_ROUTE = resolve(__dirname, "../../app/api/kody/tasks/route.ts");
const SOURCE = readFileSync(TASKS_ROUTE, "utf8");

describe("tasks route GitHub budget", () => {
  it("reads kody state only for active issues on the hot task-list poll", () => {
    expect(SOURCE).toContain(
      "const kodyTouchedIssueNumbers = activeIssueNumbers;",
    );
    expect(SOURCE).not.toContain(
      'l.name.toLowerCase().startsWith("kody:")) ||',
    );
  });

  it("keeps preview-provider calls behind includeDetails", () => {
    expect(SOURCE).toContain(
      'const includeDetails = searchParams.get("includeDetails") !== "false";',
    );

    const includeDetailsBlock = SOURCE.match(
      /if \(includeDetails\) \{[\s\S]*?const resolvedPreviewByPrNumber = await buildPreviewUrlByPrNumber[\s\S]*?\n    \}/,
    )?.[0];

    expect(includeDetailsBlock).toBeTruthy();
    expect(includeDetailsBlock).toContain("fetchDeploymentPreviews(prShas)");
    expect(includeDetailsBlock).toContain("resolvePreviewConfigForOctokit");
    expect(SOURCE).toContain(
      "includeDetails && pr ? previewByPrNumber.get(pr.number) : undefined",
    );
  });
});

/**
 * Source-level regression tests for org repository attach flow.
 *
 * `/api/kody/repos/add` returns `owner`/`repo` at the top level and a
 * lightweight `repository` object without `owner`/`name`. The org page must
 * not pass missing fields into auth-context.addRepo.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ORG_MANAGER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/OrgManager.tsx"),
  "utf8",
);
const AUTH_CONTEXT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/auth-context.tsx"),
  "utf8",
);
const ATTACH_REPOSITORY_SOURCE = ORG_MANAGER_SOURCE.slice(
  ORG_MANAGER_SOURCE.indexOf("async function attachRepository"),
  ORG_MANAGER_SOURCE.indexOf("async function createRepository"),
);

describe("OrgManager attach repository", () => {
  it("uses repos/add top-level owner and repo when adding auth entries", () => {
    expect(ORG_MANAGER_SOURCE).toMatch(/interface AttachRepoResponse/);
    expect(ATTACH_REPOSITORY_SOURCE).toMatch(/const owner = data\.owner/);
    expect(ATTACH_REPOSITORY_SOURCE).toMatch(/const repoName = data\.repo/);
    expect(ATTACH_REPOSITORY_SOURCE).toMatch(/owner,/);
    expect(ATTACH_REPOSITORY_SOURCE).toMatch(/repo:\s*repoName/);
    expect(ATTACH_REPOSITORY_SOURCE).not.toMatch(
      /owner:\s*data\.repository\.owner/,
    );
    expect(ATTACH_REPOSITORY_SOURCE).not.toMatch(
      /repo:\s*data\.repository\.name/,
    );
  });

  it("guards auth-context against malformed repo entries", () => {
    expect(AUTH_CONTEXT_SOURCE).toMatch(/Skipping malformed repository entry/);
    expect(AUTH_CONTEXT_SOURCE).toMatch(/entry\.owner\?\.trim\(\) \?\? ""/);
  });
});

/**
 * Regression test for the "Bad credentials" import failure.
 *
 * The GitHub request context (`_octokit`/`_owner`/`_repo` in github-client)
 * is a module-level global. Under Vercel Fluid Compute a concurrent request
 * can run `clearGitHubContext()` mid-import, nulling `_octokit`; after that
 * `getOctokit()` falls back to the env token, which reads 401 ("Bad
 * credentials"). The import passes a valid *user* octokit for the writes, so
 * the files are actually created — but the existence-check read and the
 * post-write confirm read both went through the (now-bad) global, so every
 * entry after the context was cleared was wrongly reported as failed.
 *
 * This test simulates that exact split: `getOctokit()` (the global) is BAD,
 * the octokit passed to `applyCompanyBundle` is GOOD. The import must use the
 * passed octokit for ALL of its GitHub access and succeed.
 *
 * Unlike company.spec.ts this does NOT mock the file helpers — it exercises
 * the real `duties-files`/`staff-files`/`commands/files`/`instructions/files`
 * so the octokit-threading is genuinely under test. Only github-client (the
 * shared context) is mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

function badError(): Error {
  const e = new Error(
    "Bad credentials - https://docs.github.com/rest",
  ) as Error & {
    status: number;
  };
  e.status = 401;
  return e;
}

// The GLOBAL request-context octokit — simulates a context cleared by a
// concurrent request (env-token fallback that 401s on everything).
const badOctokit = {
  repos: {
    get: vi.fn(async () => {
      throw badError();
    }),
    getContent: vi.fn(async () => {
      throw badError();
    }),
    listCommits: vi.fn(async () => {
      throw badError();
    }),
    createOrUpdateFileContents: vi.fn(async () => {
      throw badError();
    }),
  },
};

vi.mock("@dashboard/lib/github-client", () => ({
  getOctokit: vi.fn(() => badOctokit),
  getOwner: vi.fn(() => "acme"),
  getRepo: vi.fn(() => "widgets"),
  invalidateDutiesCache: vi.fn(),
  invalidateStaffCache: vi.fn(),
  invalidateCommandsCache: vi.fn(),
  fetchCompanyActivity: vi.fn(async () => []),
}));

import { applyCompanyBundle } from "@dashboard/lib/company/import";
import { COMPANY_BUNDLE_VERSION } from "@dashboard/lib/company/types";

/**
 * A stateful fake of the user's (valid) Octokit. Tracks files written via
 * createOrUpdateFileContents so a subsequent getContent on the same path
 * returns them — mirroring real GitHub: 404 before write, content after.
 */
function makeGoodOctokit() {
  const written = new Map<string, string>(); // path -> base64 content
  const nf = () => {
    const e = new Error("Not Found") as Error & { status: number };
    e.status = 404;
    throw e;
  };
  return {
    repos: {
      get: vi.fn(async () => ({ data: { default_branch: "main" } })),
      listCommits: vi.fn(async () => ({ data: [] })),
      createOrUpdateFileContents: vi.fn(
        async ({ path, content }: { path: string; content: string }) => {
          written.set(path, content);
          return { data: { content: { sha: `sha-${path}` }, commit: {} } };
        },
      ),
      getContent: vi.fn(async ({ path }: { path: string }) => {
        if (path.endsWith(".state.json")) return nf();
        const c = written.get(path);
        if (!c) return nf();
        return { data: { content: c, sha: `sha-${path}` } };
      }),
    },
  };
}

const bundle = {
  kodyCompany: COMPANY_BUNDLE_VERSION,
  exportedAt: "",
  exportedFrom: "",
  staff: [
    {
      slug: "cto",
      title: "CTO",
      body: "x",
      schedule: null,
      disabled: false,
      staff: null,
      stage: null,
      mentions: [],
      executables: [],
      dutyTools: [],
      tickScript: null,
      readsFrom: [],
      writesTo: [],
    },
  ],
  duties: [
    {
      slug: "nightly",
      title: "N",
      body: "y",
      schedule: "1d" as const,
      disabled: false,
      staff: "cto",
      stage: "report-refresh" as const,
      mentions: [],
      executables: [],
      dutyTools: [],
      tickScript: null,
      readsFrom: [],
      writesTo: [],
    },
  ],
  contexts: [],
  commands: [{ slug: "review", description: "d", argumentHint: "", body: "B" }],
  executables: [],
  instructions: "Be terse.",
  config: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("company import survives a cleared/bad request-context octokit", () => {
  it("creates every artifact using the passed user octokit (no Bad credentials)", async () => {
    const good = makeGoodOctokit();

    const result = await applyCompanyBundle(good as never, bundle, "skip");

    // Pre-fix: the existence-check read + confirm read used getOctokit()
    // (badOctokit) → 401 → every entry reported failed. Post-fix: all created.
    expect(result.staff).toMatchObject({ created: 1, failed: 0 });
    expect(result.duties).toMatchObject({ created: 1, failed: 0 });
    expect(result.commands).toMatchObject({ created: 1, failed: 0 });
    expect(result.instructions).toBe("created");
    expect(result.notes).toEqual([]);

    // The writes really went through the GOOD octokit...
    expect(good.repos.createOrUpdateFileContents).toHaveBeenCalled();
    // ...and the bad global octokit was never touched.
    expect(badOctokit.repos.getContent).not.toHaveBeenCalled();
    expect(badOctokit.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it("still reports a real write failure (does not mask genuine errors)", async () => {
    const good = makeGoodOctokit();
    good.repos.createOrUpdateFileContents.mockRejectedValueOnce(badError());

    const result = await applyCompanyBundle(good as never, bundle, "skip");
    // The one staff write genuinely failed; everything else still succeeded.
    expect(result.staff).toMatchObject({ created: 0, failed: 1 });
    expect(result.duties).toMatchObject({ created: 1, failed: 0 });
    expect(result.notes.some((n) => n.includes("Bad credentials"))).toBe(true);
  });
});

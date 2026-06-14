/**
 * LIVE round-trip for the generic manifest-store against the real GitHub
 * API, using the tester sandbox repo. Proves the actual discovery → create →
 * read → mutate → verify path (the part unit tests mock away) works end to
 * end, with the real ETag/cache + issue PATCH behaviour.
 *
 * Safety: this never touches the real `kody:*` manifest labels. It uses a
 * unique throwaway label per run (`kody:manifest-store-livetest:<runId>`),
 * and the afterAll hook closes the created issue and deletes the label, so
 * it cannot collide with the production manifests or the other E2E suites.
 *
 * Gated: skipped unless RUN_REAL_E2E=1 and E2E creds are present, so the
 * normal `pnpm test` stays hermetic.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Octokit } from "@octokit/rest";
import { createManifestStore } from "@dashboard/lib/manifest-store";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";

const RUN = process.env.RUN_REAL_E2E === "1";
const TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const REPO_URL = process.env.E2E_GITHUB_REPO ?? "";

function parseRepo(url: string): { owner: string; repo: string } {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!m) throw new Error(`bad E2E_GITHUB_REPO: ${url}`);
  return { owner: m[1], repo: m[2] };
}

const enabled = RUN && !!TOKEN && !!REPO_URL;
const runId = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;
const LIVE_LABEL = `kody:manifest-store-livetest:${runId}`;

interface Bag {
  version: 1;
  items: { id: string; n: number }[];
}
const MARK_START = "<!-- mstore-livetest-start -->";
const MARK_END = "<!-- mstore-livetest-end -->";

function parse(body: string | null | undefined): Bag {
  if (!body) return { version: 1, items: [] };
  const s = body.indexOf(MARK_START);
  const e = body.indexOf(MARK_END);
  if (s === -1 || e === -1 || e < s) return { version: 1, items: [] };
  const inner = body.slice(s + MARK_START.length, e);
  const o = inner.indexOf("```");
  const c = inner.lastIndexOf("```");
  if (o === -1 || c === o) return { version: 1, items: [] };
  const nl = inner.indexOf("\n", o);
  try {
    const j = JSON.parse(inner.slice(nl + 1, c).trim()) as Partial<Bag>;
    return { version: 1, items: Array.isArray(j.items) ? j.items : [] };
  } catch {
    return { version: 1, items: [] };
  }
}
function serialize(m: Bag): string {
  return `live-test manifest\n${MARK_START}\n\n\`\`\`json\n${JSON.stringify(
    m,
    null,
    2,
  )}\n\`\`\`\n\n${MARK_END}\n`;
}

const store = createManifestStore<Bag>({
  label: LIVE_LABEL,
  title: `Manifest-store live test ${runId}`,
  name: "live-test",
  parse,
  serialize,
  empty: () => ({ version: 1, items: [] }),
  equals: (a, b) =>
    a.items.length === b.items.length &&
    a.items.every((x, i) => x.id === b.items[i].id && x.n === b.items[i].n),
});

describe.skipIf(!enabled)("manifest-store · LIVE round-trip", () => {
  let octo: Octokit;
  let owner = "";
  let repo = "";
  let createdIssue: number | null = null;

  beforeAll(async () => {
    ({ owner, repo } = parseRepo(REPO_URL));
    octo = new Octokit({ auth: TOKEN });
    setGitHubContext(owner, repo, TOKEN);
    // Pre-create the throwaway label (GitHub does not auto-create labels).
    await octo.issues
      .createLabel({ owner, repo, name: LIVE_LABEL, color: "ededed" })
      .catch(() => undefined);
  }, 30_000);

  afterAll(async () => {
    try {
      if (createdIssue !== null) {
        await octo.issues.update({
          owner,
          repo,
          issue_number: createdIssue,
          state: "closed",
        });
      }
      await octo.issues
        .deleteLabel({ owner, repo, name: LIVE_LABEL })
        .catch(() => undefined);
    } finally {
      clearGitHubContext();
    }
  }, 30_000);

  it("creates the manifest issue on first write", async () => {
    const out = await store.mutate((cur) => ({
      next: { version: 1, items: [...cur.items, { id: "a", n: 1 }] },
      result: "created" as const,
    }));
    expect("issueNumber" in out).toBe(true);
    createdIssue = (out as { issueNumber: number }).issueNumber;
    expect(createdIssue).toBeGreaterThan(0);
  }, 60_000);

  it("reads back what it wrote (fresh, cache-bypassing)", async () => {
    const ref = await store.readFresh();
    expect(ref.number).toBe(createdIssue);
    expect(ref.manifest.items).toEqual([{ id: "a", n: 1 }]);
  }, 30_000);

  it("mutates the existing issue and verifies the persisted body", async () => {
    const out = await store.mutate((cur) => ({
      next: { version: 1, items: [...cur.items, { id: "b", n: 2 }] },
      result: cur.items.length,
    }));
    expect(out).toMatchObject({ result: 1, issueNumber: createdIssue });

    const again = await store.readFresh();
    expect(again.manifest.items).toEqual([
      { id: "a", n: 1 },
      { id: "b", n: 2 },
    ]);
  }, 60_000);

  it("noop leaves the issue untouched", async () => {
    const before = await store.readFresh();
    const out = await store.mutate(() => ({
      kind: "noop" as const,
      result: "skip",
    }));
    expect(out).toEqual({ kind: "noop", result: "skip" });
    const after = await store.readFresh();
    expect(after.manifest).toEqual(before.manifest);
  }, 30_000);
});

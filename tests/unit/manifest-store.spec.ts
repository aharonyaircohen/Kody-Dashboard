/**
 * Unit tests for the generic manifest-store core (src/dashboard/lib/
 * manifest-store.ts) that replaced the five copy-pasted GitHub-issue-body
 * helpers. Covers: create vs update path, parse/serialize round-trip,
 * compare-and-swap retry on a simulated concurrent writer, retry
 * exhaustion, noop short-circuit, per-repo mutex serialization, the custom
 * equality hook, and the fresh-vs-cached read split (noCache flag).
 *
 * GitHub is mocked at the `@dashboard/lib/github-client` boundary — the
 * same seam the source imports through (`./github-client`) and the same
 * pattern as issue-attachments.spec.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dashboard/lib/github-client", () => ({
  fetchIssues: vi.fn(),
  fetchIssue: vi.fn(),
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
  invalidateIssueCache: vi.fn(),
  getOwner: vi.fn(() => "acme"),
  getRepo: vi.fn(() => "widgets"),
}));

import { createManifestStore } from "@dashboard/lib/manifest-store";
import { INTERNAL_ISSUE_LABEL } from "@dashboard/lib/constants";
import {
  fetchIssues,
  fetchIssue,
  createIssue,
  updateIssue,
  invalidateIssueCache,
} from "@dashboard/lib/github-client";

const mFetchIssues = vi.mocked(fetchIssues);
const mFetchIssue = vi.mocked(fetchIssue);
const mCreateIssue = vi.mocked(createIssue);
const mUpdateIssue = vi.mocked(updateIssue);
const mInvalidate = vi.mocked(invalidateIssueCache);

// ── A tiny in-memory GitHub-issue store the mocks drive ──────────────────────

interface Bag {
  count: number;
}
const LABEL = "kody:test-manifest";

function makeParse() {
  return (body: string | null | undefined): Bag => {
    if (!body) return { count: 0 };
    try {
      const m = body.match(/COUNT=(\d+)/);
      return { count: m ? Number(m[1]) : 0 };
    } catch {
      return { count: 0 };
    }
  };
}
const serialize = (m: Bag) => `manifest body COUNT=${m.count}`;

/**
 * Wire the github-client mocks to a single mutable issue body. `onAfterWrite`
 * lets a test simulate a concurrent writer landing between our write and our
 * verify read.
 */
function wireSingleIssue(opts?: {
  existing?: { number: number; body: string } | null;
  onAfterWrite?: (state: { body: string }) => void;
}) {
  const state: { number: number | null; body: string } = {
    number: opts?.existing?.number ?? null,
    body: opts?.existing?.body ?? "",
  };

  mFetchIssues.mockImplementation((async () =>
    state.number === null
      ? []
      : [{ number: state.number }]) as unknown as typeof fetchIssues);
  mFetchIssue.mockImplementation((async () => ({
    body: state.body,
  })) as unknown as typeof fetchIssue);
  mCreateIssue.mockImplementation((async (opts: { body?: string }) => {
    state.number = 101;
    state.body = opts.body ?? "";
    return { number: 101 };
  }) as unknown as typeof createIssue);
  mUpdateIssue.mockImplementation((async (
    _n: number,
    patch: { body?: string },
  ) => {
    state.body = patch.body ?? "";
    opts?.onAfterWrite?.(state);
  }) as unknown as typeof updateIssue);

  return state;
}

const store = () =>
  createManifestStore<Bag>({
    label: LABEL,
    title: "Test Manifest",
    name: "test manifest",
    parse: makeParse(),
    serialize,
    empty: () => ({ count: 0 }),
    equals: (a, b) => a.count === b.count,
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manifest-store · create vs update", () => {
  it("creates the issue (title + label) when none exists", async () => {
    wireSingleIssue({ existing: null });
    const s = store();

    const out = await s.mutate((cur) => ({
      next: { count: cur.count + 1 },
      result: "created",
    }));

    expect(mCreateIssue).toHaveBeenCalledTimes(1);
    expect(mUpdateIssue).not.toHaveBeenCalled();
    const arg = mCreateIssue.mock.calls[0][0] as {
      title: string;
      labels: string[];
    };
    expect(arg.title).toBe("Test Manifest");
    // Manifest issues are also tagged kody:internal so they're filtered out
    // of normal issue views (see manifest-store create path).
    expect(arg.labels).toEqual([LABEL, INTERNAL_ISSUE_LABEL]);
    expect(out).toMatchObject({ result: "created", issueNumber: 101 });
    expect(mInvalidate).toHaveBeenCalledWith(101);
  });

  it("updates the existing issue and invalidates its cache", async () => {
    wireSingleIssue({ existing: { number: 7, body: "COUNT=5" } });
    const s = store();

    const out = await s.mutate((cur) => ({
      next: { count: cur.count + 1 },
      result: cur.count,
    }));

    expect(mUpdateIssue).toHaveBeenCalledTimes(1);
    expect(mCreateIssue).not.toHaveBeenCalled();
    expect(out).toMatchObject({ result: 5, issueNumber: 7 });
    expect(mInvalidate).toHaveBeenCalledWith(7);
  });

  it("round-trips through the real parse/serialize on the issue body", async () => {
    const state = wireSingleIssue({ existing: { number: 7, body: "COUNT=2" } });
    const s = store();
    await s.mutate((cur) => ({ next: { count: cur.count + 40 }, result: 0 }));
    expect(state.body).toBe("manifest body COUNT=42");
    const reread = await s.readFresh();
    expect(reread.manifest).toEqual({ count: 42 });
  });
});

describe("manifest-store · compare-and-swap", () => {
  it("retries from a fresh read when a concurrent writer clobbers our write", async () => {
    let clobbered = false;
    wireSingleIssue({
      existing: { number: 7, body: "COUNT=0" },
      onAfterWrite: (st) => {
        // First write only: a racing writer overwrites the body so our
        // verify read mismatches and we must retry.
        if (!clobbered) {
          clobbered = true;
          st.body = "COUNT=999";
        }
      },
    });
    const s = store();

    const out = await s.mutate((cur) => ({
      next: { count: cur.count + 1 },
      result: "ok",
    }));

    // Two write attempts: the clobbered one + the successful retry.
    expect(mUpdateIssue).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ result: "ok" });
  });

  it("throws a named conflict error after exhausting maxAttempts", async () => {
    wireSingleIssue({
      existing: { number: 7, body: "COUNT=0" },
      onAfterWrite: (st) => {
        st.body = "COUNT=999"; // every verify mismatches
      },
    });
    const s = store();

    await expect(
      s.mutate((cur) => ({ next: { count: cur.count + 1 }, result: 1 }), {
        maxAttempts: 3,
      }),
    ).rejects.toThrow(
      /test manifest write conflict on issue #7 \(attempt 3\/3\)/,
    );
    expect(mUpdateIssue).toHaveBeenCalledTimes(3);
  });
});

describe("manifest-store · noop", () => {
  it("skips the write and returns the noop result", async () => {
    wireSingleIssue({ existing: { number: 7, body: "COUNT=5" } });
    const s = store();

    const out = await s.mutate(() => ({
      kind: "noop" as const,
      result: "not-found",
    }));

    expect(out).toEqual({ kind: "noop", result: "not-found" });
    expect(mUpdateIssue).not.toHaveBeenCalled();
    expect(mCreateIssue).not.toHaveBeenCalled();
    expect(mInvalidate).not.toHaveBeenCalled();
  });
});

describe("manifest-store · per-repo mutex", () => {
  it("serializes concurrent mutates so the second sees the first's result", async () => {
    wireSingleIssue({ existing: { number: 7, body: "COUNT=0" } });
    const s = store();

    const [a, b] = await Promise.all([
      s.mutate((cur) => ({
        next: { count: cur.count + 1 },
        result: cur.count,
      })),
      s.mutate((cur) => ({
        next: { count: cur.count + 1 },
        result: cur.count,
      })),
    ]);

    const seen = [
      (a as { manifest: Bag }).manifest.count,
      (b as { manifest: Bag }).manifest.count,
    ].sort();
    // Serialized → 0→1 then 1→2 (never both reading 0 and both writing 1).
    expect(seen).toEqual([1, 2]);
  });
});

describe("manifest-store · custom equality hook", () => {
  it("treats a verify result equal under the entity's equals as success", async () => {
    // Body parses to the same count even though bytes differ → equals true.
    const state = wireSingleIssue({
      existing: { number: 7, body: "COUNT=1" },
    });
    const s = createManifestStore<Bag>({
      label: LABEL,
      title: "T",
      name: "t",
      parse: makeParse(),
      serialize: (m) => `noise-${Math.random()}-COUNT=${m.count}`,
      empty: () => ({ count: 0 }),
      equals: (x, y) => x.count === y.count,
    });

    const out = await s.mutate((cur) => ({
      next: { count: cur.count + 1 },
      result: "ok",
    }));

    expect(out).toMatchObject({ result: "ok" });
    expect(state.body).toContain("COUNT=2");
    expect(mUpdateIssue).toHaveBeenCalledTimes(1); // no spurious retry
  });
});

describe("manifest-store · fresh vs cached reads", () => {
  it("readFresh bypasses cache (noCache on both list + issue)", async () => {
    wireSingleIssue({ existing: { number: 7, body: "COUNT=3" } });
    const s = store();

    const ref = await s.readFresh();

    expect(ref).toEqual({ number: 7, manifest: { count: 3 } });
    expect(mFetchIssues).toHaveBeenCalledWith(
      expect.objectContaining({ noCache: true, labels: LABEL }),
    );
    expect(mFetchIssue).toHaveBeenCalledWith(7, { noCache: true });
  });

  it("readCached uses the ETag/304 path (no noCache flag)", async () => {
    wireSingleIssue({ existing: { number: 7, body: "COUNT=9" } });
    const s = store();

    const manifest = await s.readCached();

    expect(manifest).toEqual({ count: 9 });
    expect(mFetchIssues).toHaveBeenCalledWith(
      expect.not.objectContaining({ noCache: true }),
    );
    expect(mFetchIssue).toHaveBeenCalledWith(7);
  });

  it("returns a fresh empty() (not a shared instance) when no issue exists", async () => {
    wireSingleIssue({ existing: null });
    const s = store();

    const a = await s.readFresh();
    const b = await s.readFresh();

    expect(a).toEqual({ number: null, manifest: { count: 0 } });
    expect(a.manifest).not.toBe(b.manifest); // distinct objects
  });
});

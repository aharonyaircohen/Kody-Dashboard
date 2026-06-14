/**
 * Unit tests for the per-repo encrypted vault store
 * (src/dashboard/lib/vault/store.ts), which reads/writes `.kody/secrets.enc`
 * via the GitHub Contents API. The load-bearing behaviors here are the
 * rate-limit guards (60s TTL cache + in-flight dedup so polling can't
 * stampede GitHub) and the optimistic-SHA write path.
 *
 * Real crypto is used (KODY_MASTER_KEY set) so the encrypt→commit→decrypt
 * round-trip is exercised end to end; GitHub is a fake octokit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "crypto";
import { encrypt } from "@dashboard/lib/vault/crypto";
import {
  readVault,
  writeVault,
  invalidateVaultCache,
  listSecretMetadata,
  VAULT_PATH,
  type VaultDocument,
} from "@dashboard/lib/vault/store";

vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const KEY = randomBytes(32).toString("hex");
let savedKey: string | undefined;

/** Build a fake octokit whose getContent returns the given encrypted doc. */
function fakeOctokit(opts: {
  getContent?: ReturnType<typeof vi.fn>;
  createOrUpdate?: ReturnType<typeof vi.fn>;
}) {
  return {
    rest: {
      repos: {
        getContent: opts.getContent ?? vi.fn(),
        createOrUpdateFileContents: opts.createOrUpdate ?? vi.fn(),
      },
    },
  } as never;
}

/** Encode a VaultDocument the way GitHub returns it (base64 file content). */
function contentsResponse(doc: VaultDocument, sha = "sha-1") {
  const cipher = encrypt(JSON.stringify(doc));
  return {
    data: {
      type: "file",
      encoding: "base64",
      content: Buffer.from(cipher, "utf8").toString("base64"),
      sha,
    },
  };
}

const DOC: VaultDocument = {
  version: 1,
  secrets: {
    OPENAI_API_KEY: {
      value: "sk-1",
      updatedAt: "2026-01-01T00:00:00Z",
      updatedBy: "alice",
    },
  },
};

beforeEach(() => {
  savedKey = process.env.KODY_MASTER_KEY;
  process.env.KODY_MASTER_KEY = KEY;
  invalidateVaultCache("acme", "widgets");
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.KODY_MASTER_KEY;
  else process.env.KODY_MASTER_KEY = savedKey;
});

describe("readVault", () => {
  it("decrypts and parses the stored document", async () => {
    const getContent = vi.fn().mockResolvedValue(contentsResponse(DOC));
    const oct = fakeOctokit({ getContent });

    const { doc, sha } = await readVault(oct, "acme", "widgets");
    expect(doc.secrets.OPENAI_API_KEY.value).toBe("sk-1");
    expect(sha).toBe("sha-1");
  });

  it("serves a warm cache hit without a second GitHub call", async () => {
    const getContent = vi.fn().mockResolvedValue(contentsResponse(DOC));
    const oct = fakeOctokit({ getContent });

    await readVault(oct, "acme", "widgets");
    await readVault(oct, "acme", "widgets");
    expect(getContent).toHaveBeenCalledTimes(1);
  });

  it("force-refresh bypasses the cache", async () => {
    const getContent = vi.fn().mockResolvedValue(contentsResponse(DOC));
    const oct = fakeOctokit({ getContent });

    await readVault(oct, "acme", "widgets");
    await readVault(oct, "acme", "widgets", { force: true });
    expect(getContent).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent reads into one GitHub call (in-flight dedup)", async () => {
    let resolve!: (v: unknown) => void;
    const getContent = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const oct = fakeOctokit({ getContent });

    const p1 = readVault(oct, "acme", "widgets");
    const p2 = readVault(oct, "acme", "widgets");
    resolve(contentsResponse(DOC));
    const [a, b] = await Promise.all([p1, p2]);

    expect(getContent).toHaveBeenCalledTimes(1);
    expect(a.doc).toEqual(b.doc);
  });

  it("returns an empty document on 404 (vault not yet created)", async () => {
    const getContent = vi.fn().mockRejectedValue({ status: 404 });
    const oct = fakeOctokit({ getContent });

    const { doc, sha } = await readVault(oct, "acme", "widgets");
    expect(doc).toEqual({ version: 1, secrets: {} });
    expect(sha).toBeNull();
  });

  it("returns an empty document when the path is a directory, not a file", async () => {
    const getContent = vi.fn().mockResolvedValue({ data: [{ type: "file" }] });
    const oct = fakeOctokit({ getContent });

    const { doc } = await readVault(oct, "acme", "widgets");
    expect(doc.secrets).toEqual({});
  });
});

describe("writeVault", () => {
  it("encrypts, sends the current sha for optimistic concurrency, and caches the result", async () => {
    const createOrUpdate = vi
      .fn()
      .mockResolvedValue({ data: { content: { sha: "sha-2" } } });
    const oct = fakeOctokit({ createOrUpdate });

    const { sha } = await writeVault(oct, "acme", "widgets", DOC, "sha-1");

    expect(sha).toBe("sha-2");
    const args = createOrUpdate.mock.calls[0][0];
    expect(args).toMatchObject({ path: VAULT_PATH, sha: "sha-1" });
    // Content must be base64 (encrypted), never plaintext secret material.
    expect(args.content).not.toContain("sk-1");

    // The write seeds the cache: a subsequent read needs no getContent call.
    const getContent = vi.fn();
    const { doc } = await readVault(
      fakeOctokit({ getContent }),
      "acme",
      "widgets",
    );
    expect(doc.secrets.OPENAI_API_KEY.value).toBe("sk-1");
    expect(getContent).not.toHaveBeenCalled();
  });

  it("omits the sha when creating the file for the first time", async () => {
    const createOrUpdate = vi
      .fn()
      .mockResolvedValue({ data: { content: { sha: "sha-new" } } });
    const oct = fakeOctokit({ createOrUpdate });

    await writeVault(oct, "acme", "widgets", DOC, null);
    expect(createOrUpdate.mock.calls[0][0]).not.toHaveProperty("sha");
  });

  it("returns an empty sha when GitHub reports none", async () => {
    const createOrUpdate = vi.fn().mockResolvedValue({ data: { content: {} } });
    const oct = fakeOctokit({ createOrUpdate });

    const { sha } = await writeVault(oct, "acme", "widgets", DOC, "sha-1");
    expect(sha).toBe("");
  });
});

describe("listSecretMetadata", () => {
  it("strips values and sorts by name", () => {
    const doc: VaultDocument = {
      version: 1,
      secrets: {
        ZED: { value: "z", updatedAt: "t2", updatedBy: "bob" },
        ABLE: { value: "a", updatedAt: "t1" },
      },
    };
    const meta = listSecretMetadata(doc);
    expect(meta.map((m) => m.name)).toEqual(["ABLE", "ZED"]);
    expect(meta[0]).not.toHaveProperty("value");
  });
});

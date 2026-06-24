/**
 * Unit tests for the encrypted vault store. The vault is encrypted, but the
 * file itself lives in the configured external state repo.
 */

import { randomBytes } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stateRepo = vi.hoisted(() => ({
  readStateText: vi.fn(),
  writeStateText: vi.fn(),
}));

vi.mock("@dashboard/lib/state-repo", () => ({
  readStateText: stateRepo.readStateText,
  writeStateText: stateRepo.writeStateText,
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { decrypt, deriveKeyCheck, encrypt } from "@dashboard/lib/vault/crypto";
import {
  invalidateVaultCache,
  listSecretMetadata,
  readVault,
  VAULT_PATH,
  writeVault,
  type VaultDocument,
} from "@dashboard/lib/vault/store";

const KEY = randomBytes(32).toString("hex");
let savedKey: string | undefined;

function fakeOctokit() {
  return { marker: "octokit" } as never;
}

function stateFile(doc: VaultDocument, sha = "sha-1") {
  return {
    content: encrypt(JSON.stringify(doc)),
    sha,
  };
}

const DOC: VaultDocument = {
  version: 1,
  secrets: {
    API_KEY: {
      value: "super-secret",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "alice",
    },
  },
  keyCheck: deriveKeyCheck(KEY),
};

beforeEach(() => {
  savedKey = process.env.KODY_MASTER_KEY;
  process.env.KODY_MASTER_KEY = KEY;
  vi.clearAllMocks();
  invalidateVaultCache("acme", "widgets");
});

afterEach(() => {
  process.env.KODY_MASTER_KEY = savedKey;
  invalidateVaultCache("acme", "widgets");
});

describe("readVault", () => {
  it("reads and decrypts secrets.enc from the configured state repo", async () => {
    const octokit = fakeOctokit();
    stateRepo.readStateText.mockResolvedValue(stateFile(DOC));

    const { doc, sha } = await readVault(octokit, "acme", "widgets");

    expect(doc).toEqual(DOC);
    expect(sha).toBe("sha-1");
    expect(stateRepo.readStateText).toHaveBeenCalledWith(
      octokit,
      "acme",
      "widgets",
      VAULT_PATH,
      { headers: { "If-None-Match": "" } },
    );
  });

  it("caches reads per repo until invalidated", async () => {
    stateRepo.readStateText.mockResolvedValue(stateFile(DOC));
    const octokit = fakeOctokit();

    await readVault(octokit, "acme", "widgets");
    await readVault(octokit, "acme", "widgets");

    expect(stateRepo.readStateText).toHaveBeenCalledTimes(1);
  });

  it("force read bypasses cache", async () => {
    stateRepo.readStateText.mockResolvedValue(stateFile(DOC));
    const octokit = fakeOctokit();

    await readVault(octokit, "acme", "widgets");
    await readVault(octokit, "acme", "widgets", { force: true });

    expect(stateRepo.readStateText).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent reads into one state repo call", async () => {
    let resolve!: (value: unknown) => void;
    stateRepo.readStateText.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const octokit = fakeOctokit();

    const p1 = readVault(octokit, "acme", "widgets");
    const p2 = readVault(octokit, "acme", "widgets");
    resolve(stateFile(DOC));
    const [a, b] = await Promise.all([p1, p2]);

    expect(stateRepo.readStateText).toHaveBeenCalledTimes(1);
    expect(a.doc).toEqual(b.doc);
  });

  it("returns an empty document when the state file does not exist", async () => {
    stateRepo.readStateText.mockResolvedValue(null);

    const { doc, sha } = await readVault(fakeOctokit(), "acme", "widgets");

    expect(doc).toEqual({ version: 1, secrets: {} });
    expect(sha).toBeNull();
  });
});

describe("writeVault", () => {
  it("encrypts and writes secrets.enc to the configured state repo", async () => {
    stateRepo.writeStateText.mockResolvedValue({ sha: "sha-2" });
    const octokit = fakeOctokit();

    const { sha } = await writeVault(octokit, "acme", "widgets", DOC, "sha-1");

    expect(sha).toBe("sha-2");
    expect(stateRepo.writeStateText).toHaveBeenCalledTimes(1);
    const payload = stateRepo.writeStateText.mock.calls[0][0];
    expect(payload).toMatchObject({
      octokit,
      owner: "acme",
      repo: "widgets",
      path: VAULT_PATH,
      message: "chore(vault): update dashboard secrets",
      sha: "sha-1",
    });
    expect(JSON.parse(decrypt(payload.content))).toEqual(DOC);
  });

  it("adds keyCheck on first write when missing", async () => {
    stateRepo.writeStateText.mockResolvedValue({ sha: "sha-2" });
    const docWithoutKeyCheck: VaultDocument = {
      version: 1,
      secrets: DOC.secrets,
    };

    await writeVault(
      fakeOctokit(),
      "acme",
      "widgets",
      docWithoutKeyCheck,
      null,
    );

    const payload = stateRepo.writeStateText.mock.calls[0][0];
    expect(JSON.parse(decrypt(payload.content))).toEqual({
      ...docWithoutKeyCheck,
      keyCheck: deriveKeyCheck(KEY),
    });
  });

  it("returns empty sha when state repo write returns no sha", async () => {
    stateRepo.writeStateText.mockResolvedValue({ sha: null });

    const { sha } = await writeVault(
      fakeOctokit(),
      "acme",
      "widgets",
      DOC,
      null,
    );

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

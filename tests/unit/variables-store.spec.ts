/**
 * Unit tests for the plaintext variables store. Variables live in the
 * configured external state repo next to the encrypted vault.
 */

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

import {
  invalidateVariablesCache,
  listVariables,
  readVariables,
  VARIABLES_PATH,
  writeVariables,
  type VariablesDocument,
} from "@dashboard/lib/variables/store";

function fakeOctokit() {
  return { marker: "octokit" } as never;
}

const DOC: VariablesDocument = {
  version: 1,
  variables: {
    LLM_MODELS: {
      value: "[]",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "alice",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  invalidateVariablesCache("acme", "widgets");
});

afterEach(() => {
  invalidateVariablesCache("acme", "widgets");
});

describe("readVariables", () => {
  it("reads variables.json from the configured state repo", async () => {
    const octokit = fakeOctokit();
    stateRepo.readStateText.mockResolvedValue({
      content: JSON.stringify(DOC),
      sha: "sha-1",
    });

    const { doc, sha } = await readVariables(octokit, "acme", "widgets");

    expect(doc).toEqual(DOC);
    expect(sha).toBe("sha-1");
    expect(stateRepo.readStateText).toHaveBeenCalledWith(
      octokit,
      "acme",
      "widgets",
      VARIABLES_PATH,
      { headers: { "If-None-Match": "" } },
    );
  });

  it("returns an empty document when variables.json does not exist", async () => {
    stateRepo.readStateText.mockResolvedValue(null);

    const { doc, sha } = await readVariables(fakeOctokit(), "acme", "widgets");

    expect(doc).toEqual({ version: 1, variables: {} });
    expect(sha).toBeNull();
  });
});

describe("writeVariables", () => {
  it("writes variables.json to the configured state repo", async () => {
    stateRepo.writeStateText.mockResolvedValue({ sha: "sha-2" });
    const octokit = fakeOctokit();

    const { sha } = await writeVariables(
      octokit,
      "acme",
      "widgets",
      DOC,
      "sha-1",
    );

    expect(sha).toBe("sha-2");
    expect(stateRepo.writeStateText).toHaveBeenCalledWith({
      octokit,
      owner: "acme",
      repo: "widgets",
      path: VARIABLES_PATH,
      content: JSON.stringify(DOC, null, 2),
      message: "chore(variables): update dashboard variables",
      sha: "sha-1",
    });
  });
});

describe("listVariables", () => {
  it("returns values sorted by name", () => {
    const doc: VariablesDocument = {
      version: 1,
      variables: {
        ZED: { value: "z", updatedAt: "t2" },
        ABLE: { value: "a", updatedAt: "t1", updatedBy: "bob" },
      },
    };

    expect(listVariables(doc)).toEqual([
      { name: "ABLE", value: "a", updatedAt: "t1", updatedBy: "bob" },
      { name: "ZED", value: "z", updatedAt: "t2", updatedBy: undefined },
    ]);
  });
});

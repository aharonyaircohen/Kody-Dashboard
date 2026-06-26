/**
 * Unit tests for the Company import/export feature
 * (src/dashboard/lib/company/*).
 *
 * Three layers under test:
 *   - `companyBundleSchema`: validation/defaults of an uploaded bundle —
 *     discriminator, slug rules, tolerant empty collections.
 *   - `buildCompanyBundle`: maps the four file-helper reads into the
 *     portable shape, dropping repo-specific fields and built-in commands.
 *   - `applyCompanyBundle`: skip-vs-overwrite collision handling, per-
 *     collection tallies, and instructions outcomes.
 *
 * Every cross-module dependency is mocked at its import boundary — no
 * GitHub, no network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  // agent-files
  listAgentFiles: vi.fn(),
  readAgentFile: vi.fn(),
  writeAgentFile: vi.fn(),
  // commands/files
  listRepoCommandFiles: vi.fn(),
  readCommandFile: vi.fn(),
  writeCommandFile: vi.fn(),
  // context/files
  listContextFiles: vi.fn(async () => [] as Array<Record<string, unknown>>),
  readContextFile: vi.fn(async () => null as Record<string, unknown> | null),
  writeContextFile: vi.fn(),
  // instructions/files
  readInstructionsFile: vi.fn(),
  writeInstructionsFile: vi.fn(),
  // capabilities
  listCapabilityFiles: vi.fn(async () => [] as Array<Record<string, unknown>>),
  readCapabilityFolderFiles: vi.fn(
    async () => null as Record<string, string> | null,
  ),
  writeCapabilityFolderFiles: vi.fn(),
  // managed-goals-files
  listManagedGoalFiles: vi.fn(
    async () =>
      [] as Array<{
        id: string;
        path: string;
        state: Record<string, unknown>;
      }>,
  ),
  readManagedGoalFile: vi.fn(async () => null),
  writeManagedGoalFile: vi.fn(),
  // github-client
  getOwner: vi.fn(() => "acme"),
  getRepo: vi.fn(() => "widgets"),
  getOctokit: vi.fn(() => ({})),
  // engine/config
  getEngineConfig: vi.fn(async () => ({ config: {}, sha: null })),
  writeConfigPatch: vi.fn(async () => ({ sha: null })),
}));

vi.mock("@dashboard/lib/agent-files", () => ({
  listAgentFiles: h.listAgentFiles,
  readAgentFile: h.readAgentFile,
  writeAgentFile: h.writeAgentFile,
}));
vi.mock("@dashboard/lib/commands/files", () => ({
  listRepoCommandFiles: h.listRepoCommandFiles,
  readCommandFile: h.readCommandFile,
  writeCommandFile: h.writeCommandFile,
}));
vi.mock("@dashboard/lib/context/files", () => ({
  listContextFiles: h.listContextFiles,
  readContextFile: h.readContextFile,
  writeContextFile: h.writeContextFile,
}));
vi.mock("@dashboard/lib/instructions/files", () => ({
  readInstructionsFile: h.readInstructionsFile,
  writeInstructionsFile: h.writeInstructionsFile,
}));
vi.mock("@dashboard/lib/capabilities", () => ({
  listCapabilityFiles: h.listCapabilityFiles,
  readCapabilityFolderFiles: h.readCapabilityFolderFiles,
  writeCapabilityFolderFiles: h.writeCapabilityFolderFiles,
}));
vi.mock("@dashboard/lib/managed-goals-files", () => ({
  listManagedGoalFiles: h.listManagedGoalFiles,
  readManagedGoalFile: h.readManagedGoalFile,
  writeManagedGoalFile: h.writeManagedGoalFile,
}));
vi.mock("@dashboard/lib/github-client", () => ({
  getOwner: h.getOwner,
  getRepo: h.getRepo,
  getOctokit: h.getOctokit,
}));
vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: h.getEngineConfig,
  writeConfigPatch: h.writeConfigPatch,
}));

import {
  companyBundleSchema,
  COMPANY_BUNDLE_VERSION,
  type CompanyBundle,
} from "@dashboard/lib/company/types";
import { buildCompanyBundle } from "@dashboard/lib/company/export";
import { applyCompanyBundle } from "@dashboard/lib/company/import";
import type { ManagedGoalState } from "@dashboard/lib/managed-goals";

const octokit = {} as never;

const goalState: ManagedGoalState = {
  version: 1,
  state: "active",
  type: "growth",
  destination: {
    outcome: "Ship the new goals page.",
    evidence: ["goals-page-live"],
  },
  capabilities: ["release"],
  route: [
    {
      stage: "ship",
      evidence: "goals-page-live",
      capability: "release",
    },
  ],
  stage: "ship",
  facts: {},
  blockers: [],
};

function tickFile(over: Record<string, unknown> = {}) {
  return {
    slug: "s",
    title: "T",
    body: "b",
    sha: "sha1",
    updatedAt: "2026-01-01T00:00:00Z",
    htmlUrl: "https://gh/x",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("companyBundleSchema", () => {
  const base: CompanyBundle = {
    kodyCompany: COMPANY_BUNDLE_VERSION,
    exportedAt: "2026-01-01T00:00:00Z",
    exportedFrom: "acme/widgets",
    agent: [],
    contexts: [],
    commands: [],
    capabilities: [],
    goals: [],
    instructions: null,
    config: null,
  };

  it("accepts a valid bundle and applies collection defaults", () => {
    const parsed = companyBundleSchema.parse({ kodyCompany: 1 });
    expect(parsed.agent).toEqual([]);
    expect(parsed.contexts).toEqual([]);
    expect(parsed.commands).toEqual([]);
    expect(parsed.capabilities).toEqual([]);
    expect(parsed.goals).toEqual([]);
    expect(parsed.instructions).toBeNull();
  });

  it("rejects a wrong/absent discriminator", () => {
    expect(() => companyBundleSchema.parse({ kodyCompany: 2 })).toThrow();
    expect(() => companyBundleSchema.parse({ foo: "bar" })).toThrow();
  });

  it("rejects an invalid capability slug", () => {
    expect(() =>
      companyBundleSchema.parse({
        ...base,
        capabilities: [{ slug: "Bad Slug!", files: {} }],
      }),
    ).toThrow();
  });
});

describe("buildCompanyBundle", () => {
  it("maps the four reads into the portable shape and drops built-in commands", async () => {
    h.listAgentFiles.mockResolvedValue([
      tickFile({ slug: "cto", title: "CTO" }),
    ]);
    h.listCapabilityFiles.mockResolvedValue([]);
    h.listContextFiles.mockResolvedValue([
      {
        slug: "reports",
        body: "Read generated reports.",
        agent: ["*"],
        sha: "ctx",
        updatedAt: "",
        htmlUrl: "",
      },
    ]);
    h.listRepoCommandFiles.mockResolvedValue({
      commands: [
        {
          slug: "review",
          description: "d",
          argumentHint: "<x>",
          body: "B",
          source: "repo",
          sha: "s",
          updatedAt: "",
          htmlUrl: "",
        },
        {
          slug: "plan",
          description: "d",
          argumentHint: "",
          body: "B",
          source: "builtin",
          sha: "",
          updatedAt: "",
          htmlUrl: "",
        },
      ],
      builtinsDisabled: false,
    });
    h.readInstructionsFile.mockResolvedValue({
      body: "Be terse.",
      sha: "i",
      updatedAt: "",
      htmlUrl: "",
    });
    h.listManagedGoalFiles.mockResolvedValueOnce([
      {
        id: "ship-goals-page",
        path: "goals/instances/ship-goals-page/state.json",
        state: goalState,
      },
    ]);

    const bundle = await buildCompanyBundle();

    expect(bundle.kodyCompany).toBe(COMPANY_BUNDLE_VERSION);
    expect(bundle.exportedFrom).toBe("acme/widgets");
    expect(bundle.agent).toEqual([
      {
        slug: "cto",
        title: "CTO",
        body: "b",
      },
    ]);
    expect(bundle.contexts).toEqual([
      {
        slug: "reports",
        body: "Read generated reports.",
        agent: ["*"],
      },
    ]);
    // built-in command filtered out; only the repo one survives
    expect(bundle.commands).toHaveLength(1);
    expect(bundle.commands[0].slug).toBe("review");
    expect(bundle.goals).toEqual([
      {
        id: "ship-goals-page",
        state: goalState,
      },
    ]);
    expect(bundle.instructions).toBe("Be terse.");
    // repo-specific fields are not leaked into the bundle
    expect(bundle.agent[0]).not.toHaveProperty("sha");
    expect(bundle.agent[0]).not.toHaveProperty("htmlUrl");
  });

  it("emits null instructions when the file is blank/absent", async () => {
    h.listAgentFiles.mockResolvedValue([]);
    h.listCapabilityFiles.mockResolvedValue([]);
    h.listContextFiles.mockResolvedValue([]);
    h.listRepoCommandFiles.mockResolvedValue({
      commands: [],
      builtinsDisabled: false,
    });
    h.readInstructionsFile.mockResolvedValue(null);
    const bundle = await buildCompanyBundle();
    expect(bundle.instructions).toBeNull();
  });

  it("exports capability folders recursively", async () => {
    h.listAgentFiles.mockResolvedValue([]);
    h.listCapabilityFiles.mockResolvedValue([]);
    h.listContextFiles.mockResolvedValue([]);
    h.listRepoCommandFiles.mockResolvedValue({
      commands: [],
      builtinsDisabled: false,
    });
    h.readInstructionsFile.mockResolvedValue(null);
    h.listCapabilityFiles.mockResolvedValue([
      { slug: "repo-graph", describe: "", landing: "comment" },
    ]);
    h.readCapabilityFolderFiles.mockResolvedValue({
      "profile.json": '{"name":"repo-graph"}\n',
      "capability.md": "# Instructions\n",
      "skills/repo-graph/SKILL.md": "# Skill\n",
    });

    const bundle = await buildCompanyBundle();

    expect(bundle.capabilities).toEqual([
      {
        slug: "repo-graph",
        files: {
          "profile.json": '{"name":"repo-graph"}\n',
          "capability.md": "# Instructions\n",
          "skills/repo-graph/SKILL.md": "# Skill\n",
        },
      },
    ]);
  });
});

describe("applyCompanyBundle", () => {
  const bundle: CompanyBundle = {
    kodyCompany: COMPANY_BUNDLE_VERSION,
    exportedAt: "",
    exportedFrom: "",
    agent: [
      {
        slug: "cto",
        title: "CTO",
        body: "x",
      },
    ],
    commands: [
      { slug: "review", description: "d", argumentHint: "", body: "B" },
    ],
    contexts: [
      {
        slug: "reports",
        body: "Read generated reports.",
        agent: ["*"],
      },
    ],
    capabilities: [],
    goals: [],
    instructions: "Be terse.",
    config: null,
  };

  it("creates everything on a fresh repo", async () => {
    h.readAgentFile.mockResolvedValue(null);
    h.readCommandFile.mockResolvedValue(null);
    h.readContextFile.mockResolvedValue(null);
    h.readInstructionsFile.mockResolvedValue(null);
    h.writeAgentFile.mockResolvedValue({});
    h.writeCommandFile.mockResolvedValue({});
    h.writeContextFile.mockResolvedValue({});
    h.writeInstructionsFile.mockResolvedValue({});

    const result = await applyCompanyBundle(octokit, bundle, "skip");

    expect(result.agent).toMatchObject({
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
    expect(result.commands).toMatchObject({ created: 1 });
    expect(result.contexts).toMatchObject({ created: 1 });
    expect(result.instructions).toBe("created");
  });

  it("imports managed goals", async () => {
    const result = await applyCompanyBundle(
      octokit,
      {
        ...bundle,
        agent: [],
        contexts: [],
        commands: [],
        goals: [{ id: "ship-goals-page", state: goalState }],
        instructions: null,
      },
      "skip",
    );

    expect(result.goals).toMatchObject({ created: 1, failed: 0 });
    expect(h.writeManagedGoalFile).toHaveBeenCalledWith({
      octokit,
      owner: "acme",
      repo: "widgets",
      id: "ship-goals-page",
      state: goalState,
      sha: undefined,
      message: "chore(goals): import managed goal ship-goals-page",
    });
  });

  it("skips existing artifacts in skip mode (no writes)", async () => {
    h.readAgentFile.mockResolvedValue({ sha: "a" });
    h.readCommandFile.mockResolvedValue({ sha: "c" });
    h.readContextFile.mockResolvedValue({ sha: "ctx" });
    h.readInstructionsFile.mockResolvedValue({ sha: "d" });

    const result = await applyCompanyBundle(octokit, bundle, "skip");

    expect(result.agent).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(result.contexts).toMatchObject({ skipped: 1 });
    expect(result.instructions).toBe("skipped");
    expect(h.writeAgentFile).not.toHaveBeenCalled();
    expect(h.writeInstructionsFile).not.toHaveBeenCalled();
  });

  it("updates existing artifacts in overwrite mode (passes sha)", async () => {
    h.readAgentFile.mockResolvedValue({ sha: "agent-sha" });
    h.readCommandFile.mockResolvedValue({ sha: "command-sha" });
    h.readContextFile.mockResolvedValue({ sha: "ctx-sha" });
    h.readInstructionsFile.mockResolvedValue({ sha: "instr-sha" });
    h.writeAgentFile.mockResolvedValue({});
    h.writeCommandFile.mockResolvedValue({});
    h.writeContextFile.mockResolvedValue({});
    h.writeInstructionsFile.mockResolvedValue({});

    const result = await applyCompanyBundle(octokit, bundle, "overwrite");

    expect(result.agent).toMatchObject({ created: 0, updated: 1 });
    expect(result.instructions).toBe("updated");
    expect(h.writeAgentFile).toHaveBeenCalledWith(
      expect.objectContaining({ sha: "agent-sha" }),
    );
  });

  it("records a per-item failure without aborting the import", async () => {
    h.readAgentFile.mockResolvedValue(null);
    h.writeAgentFile.mockRejectedValue(new Error("boom"));
    h.readCommandFile.mockResolvedValue(null);
    h.readContextFile.mockResolvedValue(null);
    h.writeCommandFile.mockResolvedValue({});
    h.writeContextFile.mockResolvedValue({});
    h.readInstructionsFile.mockResolvedValue(null);
    h.writeInstructionsFile.mockResolvedValue({});

    const result = await applyCompanyBundle(octokit, bundle, "skip");

    expect(result.agent).toMatchObject({ failed: 1, created: 0 });
    expect(result.notes.some((n) => n.includes("boom"))).toBe(true);
  });

  it("reports instructions absent when the bundle has none", async () => {
    h.readAgentFile.mockResolvedValue(null);
    h.readCommandFile.mockResolvedValue(null);
    h.readContextFile.mockResolvedValue(null);
    h.writeAgentFile.mockResolvedValue({});
    h.writeCommandFile.mockResolvedValue({});
    h.writeContextFile.mockResolvedValue({});
    const result = await applyCompanyBundle(
      octokit,
      { ...bundle, instructions: null },
      "skip",
    );
    expect(result.instructions).toBe("absent");
    expect(h.writeInstructionsFile).not.toHaveBeenCalled();
  });

  it("imports capability folders exactly, including nested dependencies", async () => {
    const files = {
      "profile.json": '{"name":"repo-graph"}\n',
      "capability.md": "# Instructions\n",
      "skills/repo-graph/SKILL.md": "# Skill\n",
    };
    h.readCapabilityFolderFiles.mockResolvedValue(null);
    h.writeCapabilityFolderFiles.mockResolvedValue(undefined);

    const result = await applyCompanyBundle(
      octokit,
      {
        ...bundle,
        agent: [],
        contexts: [],
        commands: [],
        capabilities: [{ slug: "repo-graph", files }],
        goals: [],
        instructions: null,
      },
      "skip",
    );

    expect(result.capabilities).toMatchObject({ created: 1, failed: 0 });
    expect(h.writeCapabilityFolderFiles).toHaveBeenCalledWith({
      octokit,
      slug: "repo-graph",
      files,
      isUpdate: false,
    });
  });
});

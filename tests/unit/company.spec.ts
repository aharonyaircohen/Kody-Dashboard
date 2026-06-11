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
  // duties-files
  listDutyFiles: vi.fn(),
  readDutyFile: vi.fn(),
  writeDutyFile: vi.fn(),
  // staff-files
  listStaffFiles: vi.fn(),
  readStaffFile: vi.fn(),
  writeStaffFile: vi.fn(),
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
  // executables
  listExecutableFiles: vi.fn(async () => [] as Array<Record<string, unknown>>),
  readExecutableFile: vi.fn(async () => null),
  writeExecutableFile: vi.fn(),
  readExecutableFolderFiles: vi.fn(
    async () => null as Record<string, string> | null,
  ),
  writeExecutableFolderFiles: vi.fn(),
  fieldsFromProfile: vi.fn(() => ({})),
  // github-client
  getOwner: vi.fn(() => "acme"),
  getRepo: vi.fn(() => "widgets"),
  getOctokit: vi.fn(() => ({})),
  // engine/config
  getEngineConfig: vi.fn(async () => ({ config: {}, sha: null })),
  writeConfigPatch: vi.fn(async () => ({ sha: null })),
}));

vi.mock("@dashboard/lib/duties-files", () => ({
  listDutyFiles: h.listDutyFiles,
  readDutyFile: h.readDutyFile,
  writeDutyFile: h.writeDutyFile,
}));
vi.mock("@dashboard/lib/staff-files", () => ({
  listStaffFiles: h.listStaffFiles,
  readStaffFile: h.readStaffFile,
  writeStaffFile: h.writeStaffFile,
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
vi.mock("@dashboard/lib/executables", () => ({
  listExecutableFiles: h.listExecutableFiles,
  readExecutableFile: h.readExecutableFile,
  writeExecutableFile: h.writeExecutableFile,
  readExecutableFolderFiles: h.readExecutableFolderFiles,
  writeExecutableFolderFiles: h.writeExecutableFolderFiles,
  fieldsFromProfile: h.fieldsFromProfile,
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

const octokit = {} as never;

function tickFile(over: Record<string, unknown> = {}) {
  return {
    slug: "s",
    title: "T",
    body: "b",
    sha: "sha1",
    updatedAt: "2026-01-01T00:00:00Z",
    lastTickAt: null,
    nextEligibleAt: null,
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
    staff: [],
    duties: [],
    contexts: [],
    commands: [],
    executables: [],
    instructions: null,
    config: null,
  };

  it("accepts a valid bundle and applies collection defaults", () => {
    const parsed = companyBundleSchema.parse({ kodyCompany: 1 });
    expect(parsed.staff).toEqual([]);
    expect(parsed.duties).toEqual([]);
    expect(parsed.contexts).toEqual([]);
    expect(parsed.commands).toEqual([]);
    expect(parsed.instructions).toBeNull();
  });

  it("rejects a wrong/absent discriminator", () => {
    expect(() => companyBundleSchema.parse({ kodyCompany: 2 })).toThrow();
    expect(() => companyBundleSchema.parse({ foo: "bar" })).toThrow();
  });

  it("rejects an invalid duty slug", () => {
    expect(() =>
      companyBundleSchema.parse({
        ...base,
        duties: [{ slug: "Bad Slug!", title: "x" }],
      }),
    ).toThrow();
  });

  it("defaults a duty's schedule/disabled/staff and keeps a valid one", () => {
    const parsed = companyBundleSchema.parse({
      ...base,
      duties: [
        {
          slug: "nightly",
          title: "Nightly",
          body: "do it",
          schedule: "1d",
          staff: "cto",
          stage: "report-refresh",
        },
        { slug: "ad-hoc", title: "Ad hoc" },
      ],
    });
    expect(parsed.duties[0]).toMatchObject({
      schedule: "1d",
      staff: "cto",
      disabled: false,
    });
    expect(parsed.duties[1]).toMatchObject({
      schedule: null,
      staff: null,
      disabled: false,
      body: "",
      mentions: [],
      executables: [],
      dutyTools: [],
      tickScript: null,
      readsFrom: [],
      writesTo: [],
    });
  });
});

describe("buildCompanyBundle", () => {
  it("maps the four reads into the portable shape and drops built-in commands", async () => {
    h.listStaffFiles.mockResolvedValue([
      tickFile({ slug: "cto", title: "CTO" }),
    ]);
    h.listDutyFiles.mockResolvedValue([
      tickFile({
        slug: "nightly",
        title: "Nightly",
        schedule: "1d",
        staff: "cto",
        stage: "report-refresh",
        mentions: ["alice"],
        executables: ["ci-health-graph"],
        dutyTools: ["read_report"],
        tickScript: ".kody/scripts/nightly.sh",
        readsFrom: ["company-graph"],
        writesTo: ["ci-health-graph"],
      }),
    ]);
    h.listContextFiles.mockResolvedValue([
      {
        slug: "reports",
        body: "Read generated reports.",
        staff: ["*"],
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

    const bundle = await buildCompanyBundle();

    expect(bundle.kodyCompany).toBe(COMPANY_BUNDLE_VERSION);
    expect(bundle.exportedFrom).toBe("acme/widgets");
    expect(bundle.staff).toEqual([
      {
        slug: "cto",
        title: "CTO",
        body: "b",
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
    ]);
    expect(bundle.duties[0]).toMatchObject({
      slug: "nightly",
      schedule: "1d",
      staff: "cto",
      stage: "report-refresh",
      mentions: ["alice"],
      executables: ["ci-health-graph"],
      dutyTools: ["read_report"],
      tickScript: ".kody/scripts/nightly.sh",
      readsFrom: ["company-graph"],
      writesTo: ["ci-health-graph"],
    });
    expect(bundle.contexts).toEqual([
      {
        slug: "reports",
        body: "Read generated reports.",
        staff: ["*"],
      },
    ]);
    // built-in command filtered out; only the repo one survives
    expect(bundle.commands).toHaveLength(1);
    expect(bundle.commands[0].slug).toBe("review");
    expect(bundle.instructions).toBe("Be terse.");
    // repo-specific fields are not leaked into the bundle
    expect(bundle.staff[0]).not.toHaveProperty("sha");
    expect(bundle.staff[0]).not.toHaveProperty("htmlUrl");
  });

  it("emits null instructions when the file is blank/absent", async () => {
    h.listStaffFiles.mockResolvedValue([]);
    h.listDutyFiles.mockResolvedValue([]);
    h.listContextFiles.mockResolvedValue([]);
    h.listRepoCommandFiles.mockResolvedValue({
      commands: [],
      builtinsDisabled: false,
    });
    h.readInstructionsFile.mockResolvedValue(null);
    const bundle = await buildCompanyBundle();
    expect(bundle.instructions).toBeNull();
  });

  it("exports executable folders recursively", async () => {
    h.listStaffFiles.mockResolvedValue([]);
    h.listDutyFiles.mockResolvedValue([]);
    h.listContextFiles.mockResolvedValue([]);
    h.listRepoCommandFiles.mockResolvedValue({
      commands: [],
      builtinsDisabled: false,
    });
    h.readInstructionsFile.mockResolvedValue(null);
    h.listExecutableFiles.mockResolvedValue([
      { slug: "repo-graph", describe: "", landing: "comment" },
    ]);
    h.readExecutableFolderFiles.mockResolvedValue({
      "profile.json": '{"name":"repo-graph"}\n',
      "prompt.md": "# Instructions\n",
      "scripts/refresh.cjs": "console.log('ok');\n",
      "skills/repo-graph/SKILL.md": "# Skill\n",
      "templates/report.md": "# Report\n",
    });

    const bundle = await buildCompanyBundle();

    expect(bundle.executables).toEqual([
      {
        slug: "repo-graph",
        files: {
          "profile.json": '{"name":"repo-graph"}\n',
          "prompt.md": "# Instructions\n",
          "scripts/refresh.cjs": "console.log('ok');\n",
          "skills/repo-graph/SKILL.md": "# Skill\n",
          "templates/report.md": "# Report\n",
        },
      },
    ]);
  });
});

describe("applyCompanyBundle", () => {
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
        mentions: ["alice"],
        executables: ["ci-health-graph"],
        dutyTools: ["read_report"],
        tickScript: ".kody/scripts/nightly.sh",
        readsFrom: ["company-graph"],
        writesTo: ["ci-health-graph"],
      },
    ],
    commands: [
      { slug: "review", description: "d", argumentHint: "", body: "B" },
    ],
    contexts: [
      {
        slug: "reports",
        body: "Read generated reports.",
        staff: ["*"],
      },
    ],
    executables: [],
    instructions: "Be terse.",
    config: null,
  };

  it("creates everything on a fresh repo", async () => {
    h.readStaffFile.mockResolvedValue(null);
    h.readDutyFile.mockResolvedValue(null);
    h.readCommandFile.mockResolvedValue(null);
    h.readContextFile.mockResolvedValue(null);
    h.readInstructionsFile.mockResolvedValue(null);
    h.writeStaffFile.mockResolvedValue({});
    h.writeDutyFile.mockResolvedValue({});
    h.writeCommandFile.mockResolvedValue({});
    h.writeContextFile.mockResolvedValue({});
    h.writeInstructionsFile.mockResolvedValue({});

    const result = await applyCompanyBundle(octokit, bundle, "skip");

    expect(result.staff).toMatchObject({
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
    expect(result.duties).toMatchObject({ created: 1, skipped: 0 });
    expect(result.commands).toMatchObject({ created: 1 });
    expect(result.contexts).toMatchObject({ created: 1 });
    expect(result.instructions).toBe("created");
    // a duty carries its staff slug through to the writer
    expect(h.writeDutyFile).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "nightly",
        staff: "cto",
        schedule: "1d",
        stage: "report-refresh",
        mentions: ["alice"],
        executables: ["ci-health-graph"],
        dutyTools: ["read_report"],
        tickScript: ".kody/scripts/nightly.sh",
        readsFrom: ["company-graph"],
        writesTo: ["ci-health-graph"],
      }),
    );
  });

  it("skips existing artifacts in skip mode (no writes)", async () => {
    h.readStaffFile.mockResolvedValue({ sha: "a" });
    h.readDutyFile.mockResolvedValue({ sha: "b" });
    h.readCommandFile.mockResolvedValue({ sha: "c" });
    h.readContextFile.mockResolvedValue({ sha: "ctx" });
    h.readInstructionsFile.mockResolvedValue({ sha: "d" });

    const result = await applyCompanyBundle(octokit, bundle, "skip");

    expect(result.staff).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(result.contexts).toMatchObject({ skipped: 1 });
    expect(result.instructions).toBe("skipped");
    expect(h.writeStaffFile).not.toHaveBeenCalled();
    expect(h.writeInstructionsFile).not.toHaveBeenCalled();
  });

  it("updates existing artifacts in overwrite mode (passes sha)", async () => {
    h.readStaffFile.mockResolvedValue({ sha: "staff-sha" });
    h.readDutyFile.mockResolvedValue({ sha: "duty-sha" });
    h.readCommandFile.mockResolvedValue({ sha: "command-sha" });
    h.readContextFile.mockResolvedValue({ sha: "ctx-sha" });
    h.readInstructionsFile.mockResolvedValue({ sha: "instr-sha" });
    h.writeStaffFile.mockResolvedValue({});
    h.writeDutyFile.mockResolvedValue({});
    h.writeCommandFile.mockResolvedValue({});
    h.writeContextFile.mockResolvedValue({});
    h.writeInstructionsFile.mockResolvedValue({});

    const result = await applyCompanyBundle(octokit, bundle, "overwrite");

    expect(result.staff).toMatchObject({ created: 0, updated: 1 });
    expect(result.instructions).toBe("updated");
    expect(h.writeStaffFile).toHaveBeenCalledWith(
      expect.objectContaining({ sha: "staff-sha" }),
    );
  });

  it("records a per-item failure without aborting the import", async () => {
    h.readStaffFile.mockResolvedValue(null);
    h.writeStaffFile.mockRejectedValue(new Error("boom"));
    h.readDutyFile.mockResolvedValue(null);
    h.writeDutyFile.mockResolvedValue({});
    h.readCommandFile.mockResolvedValue(null);
    h.readContextFile.mockResolvedValue(null);
    h.writeCommandFile.mockResolvedValue({});
    h.writeContextFile.mockResolvedValue({});
    h.readInstructionsFile.mockResolvedValue(null);
    h.writeInstructionsFile.mockResolvedValue({});

    const result = await applyCompanyBundle(octokit, bundle, "skip");

    expect(result.staff).toMatchObject({ failed: 1, created: 0 });
    expect(result.duties).toMatchObject({ created: 1 });
    expect(result.notes.some((n) => n.includes("boom"))).toBe(true);
  });

  it("reports instructions absent when the bundle has none", async () => {
    h.readStaffFile.mockResolvedValue(null);
    h.readDutyFile.mockResolvedValue(null);
    h.readCommandFile.mockResolvedValue(null);
    h.readContextFile.mockResolvedValue(null);
    h.writeStaffFile.mockResolvedValue({});
    h.writeDutyFile.mockResolvedValue({});
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

  it("imports executable folders exactly, including nested dependencies", async () => {
    const files = {
      "profile.json": '{"name":"repo-graph"}\n',
      "prompt.md": "# Instructions\n",
      "scripts/refresh.cjs": "console.log('ok');\n",
      "skills/repo-graph/SKILL.md": "# Skill\n",
      "templates/report.md": "# Report\n",
    };
    h.readExecutableFolderFiles.mockResolvedValue(null);
    h.writeExecutableFolderFiles.mockResolvedValue(undefined);

    const result = await applyCompanyBundle(
      octokit,
      {
        ...bundle,
        staff: [],
        duties: [],
        contexts: [],
        commands: [],
        executables: [{ slug: "repo-graph", files }],
        instructions: null,
      },
      "skip",
    );

    expect(result.executables).toMatchObject({ created: 1, failed: 0 });
    expect(h.writeExecutableFolderFiles).toHaveBeenCalledWith({
      octokit,
      slug: "repo-graph",
      files,
      isUpdate: false,
    });
    expect(h.writeExecutableFile).not.toHaveBeenCalled();
  });
});

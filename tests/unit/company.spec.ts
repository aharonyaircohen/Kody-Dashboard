/**
 * Unit tests for the Company import/export feature
 * (src/dashboard/lib/company/*).
 *
 * Three layers under test:
 *   - `companyBundleSchema`: validation/defaults of an uploaded bundle —
 *     discriminator, slug rules, tolerant empty collections.
 *   - `buildCompanyBundle`: maps the four file-helper reads into the
 *     portable shape, dropping repo-specific fields and built-in prompts.
 *   - `applyCompanyBundle`: skip-vs-overwrite collision handling, per-
 *     collection tallies, and instructions outcomes.
 *   - `rewriteStaffKey`: the migration's `worker:` → `staff:` frontmatter
 *     rewrite (frontmatter only, never the body).
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
  // prompts/files
  listRepoPromptFiles: vi.fn(),
  readPromptFile: vi.fn(),
  writePromptFile: vi.fn(),
  // instructions/files
  readInstructionsFile: vi.fn(),
  writeInstructionsFile: vi.fn(),
  // github-client
  getOwner: vi.fn(() => "acme"),
  getRepo: vi.fn(() => "widgets"),
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
vi.mock("@dashboard/lib/prompts/files", () => ({
  listRepoPromptFiles: h.listRepoPromptFiles,
  readPromptFile: h.readPromptFile,
  writePromptFile: h.writePromptFile,
}));
vi.mock("@dashboard/lib/instructions/files", () => ({
  readInstructionsFile: h.readInstructionsFile,
  writeInstructionsFile: h.writeInstructionsFile,
}));
vi.mock("@dashboard/lib/github-client", () => ({
  getOwner: h.getOwner,
  getRepo: h.getRepo,
  invalidateDutiesCache: vi.fn(),
  invalidateStaffCache: vi.fn(),
}));

import {
  companyBundleSchema,
  COMPANY_BUNDLE_VERSION,
  type CompanyBundle,
} from "@dashboard/lib/company/types";
import { buildCompanyBundle } from "@dashboard/lib/company/export";
import { applyCompanyBundle } from "@dashboard/lib/company/import";
import { rewriteStaffKey } from "@dashboard/lib/company/migrate";

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
    prompts: [],
    instructions: null,
  };

  it("accepts a valid bundle and applies collection defaults", () => {
    const parsed = companyBundleSchema.parse({ kodyCompany: 1 });
    expect(parsed.staff).toEqual([]);
    expect(parsed.duties).toEqual([]);
    expect(parsed.prompts).toEqual([]);
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
        { slug: "nightly", title: "Nightly", body: "do it", schedule: "1d", staff: "cto" },
        { slug: "ad-hoc", title: "Ad hoc" },
      ],
    });
    expect(parsed.duties[0]).toMatchObject({ schedule: "1d", staff: "cto", disabled: false });
    expect(parsed.duties[1]).toMatchObject({ schedule: null, staff: null, disabled: false, body: "" });
  });
});

describe("buildCompanyBundle", () => {
  it("maps the four reads into the portable shape and drops built-in prompts", async () => {
    h.listStaffFiles.mockResolvedValue([tickFile({ slug: "cto", title: "CTO" })]);
    h.listDutyFiles.mockResolvedValue([
      tickFile({ slug: "nightly", title: "Nightly", schedule: "1d", staff: "cto" }),
    ]);
    h.listRepoPromptFiles.mockResolvedValue({
      prompts: [
        { slug: "review", description: "d", argumentHint: "<x>", body: "B", source: "repo", sha: "s", updatedAt: "", htmlUrl: "" },
        { slug: "plan", description: "d", argumentHint: "", body: "B", source: "builtin", sha: "", updatedAt: "", htmlUrl: "" },
      ],
      builtinsDisabled: false,
    });
    h.readInstructionsFile.mockResolvedValue({ body: "Be terse.", sha: "i", updatedAt: "", htmlUrl: "" });

    const bundle = await buildCompanyBundle();

    expect(bundle.kodyCompany).toBe(COMPANY_BUNDLE_VERSION);
    expect(bundle.exportedFrom).toBe("acme/widgets");
    expect(bundle.staff).toEqual([
      { slug: "cto", title: "CTO", body: "b", schedule: null, disabled: false, staff: null },
    ]);
    expect(bundle.duties[0]).toMatchObject({ slug: "nightly", schedule: "1d", staff: "cto" });
    // built-in prompt filtered out; only the repo one survives
    expect(bundle.prompts).toHaveLength(1);
    expect(bundle.prompts[0].slug).toBe("review");
    expect(bundle.instructions).toBe("Be terse.");
    // repo-specific fields are not leaked into the bundle
    expect(bundle.staff[0]).not.toHaveProperty("sha");
    expect(bundle.staff[0]).not.toHaveProperty("htmlUrl");
  });

  it("emits null instructions when the file is blank/absent", async () => {
    h.listStaffFiles.mockResolvedValue([]);
    h.listDutyFiles.mockResolvedValue([]);
    h.listRepoPromptFiles.mockResolvedValue({ prompts: [], builtinsDisabled: false });
    h.readInstructionsFile.mockResolvedValue(null);
    const bundle = await buildCompanyBundle();
    expect(bundle.instructions).toBeNull();
  });
});

describe("applyCompanyBundle", () => {
  const bundle = {
    kodyCompany: COMPANY_BUNDLE_VERSION,
    exportedAt: "",
    exportedFrom: "",
    staff: [{ slug: "cto", title: "CTO", body: "x", schedule: null, disabled: false, staff: null }],
    duties: [{ slug: "nightly", title: "N", body: "y", schedule: "1d" as const, disabled: false, staff: "cto" }],
    prompts: [{ slug: "review", description: "d", argumentHint: "", body: "B" }],
    instructions: "Be terse.",
  };

  it("creates everything on a fresh repo", async () => {
    h.readStaffFile.mockResolvedValue(null);
    h.readDutyFile.mockResolvedValue(null);
    h.readPromptFile.mockResolvedValue(null);
    h.readInstructionsFile.mockResolvedValue(null);
    h.writeStaffFile.mockResolvedValue({});
    h.writeDutyFile.mockResolvedValue({});
    h.writePromptFile.mockResolvedValue({});
    h.writeInstructionsFile.mockResolvedValue({});

    const result = await applyCompanyBundle(octokit, bundle, "skip");

    expect(result.staff).toMatchObject({ created: 1, updated: 0, skipped: 0, failed: 0 });
    expect(result.duties).toMatchObject({ created: 1, skipped: 0 });
    expect(result.prompts).toMatchObject({ created: 1 });
    expect(result.instructions).toBe("created");
    // a duty carries its staff slug through to the writer
    expect(h.writeDutyFile).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "nightly", staff: "cto", schedule: "1d" }),
    );
  });

  it("skips existing artifacts in skip mode (no writes)", async () => {
    h.readStaffFile.mockResolvedValue({ sha: "a" });
    h.readDutyFile.mockResolvedValue({ sha: "b" });
    h.readPromptFile.mockResolvedValue({ sha: "c" });
    h.readInstructionsFile.mockResolvedValue({ sha: "d" });

    const result = await applyCompanyBundle(octokit, bundle, "skip");

    expect(result.staff).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(result.instructions).toBe("skipped");
    expect(h.writeStaffFile).not.toHaveBeenCalled();
    expect(h.writeInstructionsFile).not.toHaveBeenCalled();
  });

  it("updates existing artifacts in overwrite mode (passes sha)", async () => {
    h.readStaffFile.mockResolvedValue({ sha: "staff-sha" });
    h.readDutyFile.mockResolvedValue({ sha: "duty-sha" });
    h.readPromptFile.mockResolvedValue({ sha: "prompt-sha" });
    h.readInstructionsFile.mockResolvedValue({ sha: "instr-sha" });
    h.writeStaffFile.mockResolvedValue({});
    h.writeDutyFile.mockResolvedValue({});
    h.writePromptFile.mockResolvedValue({});
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
    h.readPromptFile.mockResolvedValue(null);
    h.writePromptFile.mockResolvedValue({});
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
    h.readPromptFile.mockResolvedValue(null);
    h.writeStaffFile.mockResolvedValue({});
    h.writeDutyFile.mockResolvedValue({});
    h.writePromptFile.mockResolvedValue({});
    const result = await applyCompanyBundle(
      octokit,
      { ...bundle, instructions: null },
      "skip",
    );
    expect(result.instructions).toBe("absent");
    expect(h.writeInstructionsFile).not.toHaveBeenCalled();
  });
});

describe("rewriteStaffKey (migration)", () => {
  it("rewrites worker: → staff: inside frontmatter", () => {
    const src = "---\nevery: 1d\nworker: ceo\ndisabled: true\n---\n\n# job\nbody\n";
    const out = rewriteStaffKey(src);
    expect(out).toContain("staff: ceo");
    expect(out).not.toMatch(/^worker:/m);
    // body + other keys untouched
    expect(out).toContain("every: 1d");
    expect(out).toContain("# job\nbody");
  });

  it("leaves a body line that merely says worker: alone", () => {
    const src = "---\nevery: 1d\n---\n\n# duty\nthe worker: should stay\n";
    const out = rewriteStaffKey(src);
    expect(out).toContain("the worker: should stay");
  });

  it("is a no-op when there is no frontmatter", () => {
    const src = "# duty\nworker: not-frontmatter\n";
    expect(rewriteStaffKey(src)).toBe(src);
  });
});

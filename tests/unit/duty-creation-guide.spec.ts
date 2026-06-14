import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  loadChatDefaults,
} from "../../src/dashboard/lib/chat-defaults";
import { DEFAULT_EXECUTABLE } from "../../src/dashboard/lib/chat-defaults/defaults";

const DUTY_GUIDE = readFileSync("docs/duties.md", "utf8");
const DUTY_TOOLS_SOURCE = readFileSync(
  "app/api/kody/chat/tools/duty-tools.ts",
  "utf8",
);
const DUTY_FILES_SOURCE = readFileSync(
  "src/dashboard/lib/duties-files.ts",
  "utf8",
);
const TICKED_FILES_SOURCE = readFileSync(
  "src/dashboard/lib/ticked/files.ts",
  "utf8",
);

describe("duty creation guide wiring", () => {
  it("documents the user-facing duty contract", () => {
    expect(DUTY_GUIDE).toContain("A **duty** is recurring work");
    expect(DUTY_GUIDE).toContain("`create_or_update_kody_duty`");
    expect(DUTY_GUIDE).toContain("`runner`");
    expect(DUTY_GUIDE).toContain("`reviewer`");
    expect(DUTY_GUIDE).toContain("Runtime state");
    expect(DUTY_GUIDE).not.toContain("Progress types");
    expect(DUTY_GUIDE).not.toContain("`stage`");
  });

  it("exposes a guide tool before duty creation", () => {
    expect(DUTY_TOOLS_SOURCE).toContain("read_duty_creation_guide");
    expect(DUTY_TOOLS_SOURCE).toContain("canCreateDuty: true");
    expect(DUTY_TOOLS_SOURCE).toContain("docs/duties.md");
    expect(DUTY_TOOLS_SOURCE).toContain(
      "Before calling it, call read_duty_creation_guide",
    );
    // The bundle's executable declares the tool the agent should call.
    expect(DEFAULT_EXECUTABLE.tools).toContain("read_duty_creation_guide");
  });

  it("creates usable duties without authoring raw state keys", () => {
    // The dashboard writes the canonical staff slug to profile.json and
    // mirrors it to runner for legacy readers. Both must be set when the
    // tool is given a staff value.
    expect(DUTY_TOOLS_SOURCE).toContain("staff: createStaff!");
    expect(DUTY_TOOLS_SOURCE).toContain("staff: nextStaff");
    expect(DUTY_TOOLS_SOURCE).toContain("reviewer: input.reviewer");
    expect(DUTY_TOOLS_SOURCE).toContain("schedule: input.schedule");
    expect(DUTY_TOOLS_SOURCE).not.toContain("stage: input.stage");
    expect(DUTY_TOOLS_SOURCE).not.toContain("DUTY_STAGE");
    expect(DUTY_TOOLS_SOURCE).not.toContain("body += `## State");
    expect(DUTY_TOOLS_SOURCE).not.toContain("data.lastRunISO");
  });

  it("exposes a unified create-or-update tool, not a create-only tool", () => {
    expect(DUTY_TOOLS_SOURCE).toContain("create_or_update_kody_duty");
    expect(DUTY_TOOLS_SOURCE).not.toContain('"create_kody_duty"');
    expect(DUTY_TOOLS_SOURCE).not.toContain("'create_kody_duty'");
    // The bundle's executable declares the tool the agent should call.
    expect(DEFAULT_EXECUTABLE.tools).toContain("create_or_update_kody_duty");
    expect(DEFAULT_EXECUTABLE.tools).not.toContain("create_kody_duty");
  });

  it("branches on existing-folder presence to choose create vs update", () => {
    expect(DUTY_TOOLS_SOURCE).toContain('action: "created"');
    expect(DUTY_TOOLS_SOURCE).toContain('action: "updated"');
    expect(DUTY_TOOLS_SOURCE).toContain("missing_required_fields");
  });

  it("enforces read-merge semantics on update (no overwrite of omitted fields)", () => {
    expect(DUTY_TOOLS_SOURCE).toContain("existing.sha");
    expect(DUTY_TOOLS_SOURCE).toContain("chore(duties): update");
    expect(DUTY_TOOLS_SOURCE).toContain("feat(duties): add");
    // staff/runner read-merge: prefer input.staff, fall back to input.runner,
    // then to existing.runner. Either as one chain or split into steps.
    expect(DUTY_TOOLS_SOURCE).toMatch(
      /input\.staff\s*\?\?\s*input\.runner/,
    );
    expect(DUTY_TOOLS_SOURCE).toMatch(
      /input\.schedule\s*\?\?\s*existing\.schedule\s*\?\?\s*undefined/,
    );
    // Body resolution: explicit body wins; output-mode-switch regenerates
    // the body; otherwise the existing body is preserved.
    expect(DUTY_TOOLS_SOURCE).toContain("input.body !== undefined");
    expect(DUTY_TOOLS_SOURCE).toContain("outputSwitched");
    expect(DUTY_TOOLS_SOURCE).toContain("nextBody = existing.body");
  });

  it("accepts `staff` as the engine-aligned persona field, with `runner` as a deprecated alias", async () => {
    // The tool schema exposes `staff` (primary) and `runner` (alias).
    expect(DUTY_TOOLS_SOURCE).toMatch(/staff:\s*z[\s\S]*?\.string\(\)/);
    expect(DUTY_TOOLS_SOURCE).toMatch(/runner:\s*z[\s\S]*?\.string\(\)/);
    // The buildDutyProfile layer writes to BOTH profile.staff and
    // profile.runner so the engine reads config.staff while legacy
    // readers that look for `runner` still work.
    expect(DUTY_FILES_SOURCE).toContain("profile.staff = staffSlug");
    expect(DUTY_FILES_SOURCE).toContain("profile.runner = staffSlug");
    expect(DUTY_FILES_SOURCE).toMatch(
      /opts\.staff\s*\?\?\s*opts\.runner/,
    );
    // The chat-defaults bundle's `create-duty` skill teaches the model
    // the new field name.
    const bundle = await loadChatDefaults("acme", "repo");
    const createDuty = bundle.skills["create-duty"];
    expect(createDuty).toBeDefined();
    expect(createDuty!.body).toContain("`staff`");
    expect(createDuty!.body).toContain("`runner`");
    expect(createDuty!.body).toContain("`config.staff`");
  });

  it("supports multi-executable duties via the `executables` array", () => {
    // Schema exposes the plural array as a first-class field.
    expect(DUTY_TOOLS_SOURCE).toMatch(
      /executables:\s*z[\s\S]*?\.array\(z\.string/,
    );
    // The body builder produces a `## Executables` (plural) section when
    // more than one executable is supplied, and stays on the singular
    // `## Executable` for the 1-element case.
    expect(DUTY_TOOLS_SOURCE).toContain("## Executable");
    expect(DUTY_TOOLS_SOURCE).toContain("## Executables");
    // The create path forwards the validated array to writeDutyFile.
    expect(DUTY_TOOLS_SOURCE).toMatch(
      /executables:\s*executables\.length\s*>\s*0/,
    );
    // The update path forwards nextExecutables (read-merged with
    // existing.executables) to writeDutyFile.
    expect(DUTY_TOOLS_SOURCE).toContain("nextExecutables");
  });

  it("accepts raw profile.json field overrides via the `profile` parameter", () => {
    // The TickWriteOptions interface declares the raw override.
    expect(TICKED_FILES_SOURCE).toContain(
      "extraProfile?: Record<string, unknown>",
    );
    // The tool schema exposes the `profile` object to the model.
    expect(DUTY_TOOLS_SOURCE).toMatch(
      /profile:\s*z[\s\S]*?\.record\(z\.string\(\),\s*z\.unknown\(\)\)/,
    );
    // The tool forwards it as `extraProfile` to writeDutyFile.
    expect(DUTY_TOOLS_SOURCE).toContain("extraProfile: input.profile");
    // The buildDutyProfile layer merges extraProfile on top of the typed
    // fields, but typed values WIN for every key this function manages
    // (identity + schedule/disabled/staff/runner/reviewer/etc.) — the
    // override is for ADDING fields, not clobbering typed ones.
    expect(DUTY_FILES_SOURCE).toContain("opts.extraProfile");
    expect(DUTY_FILES_SOURCE).toContain("MANAGED_PROFILE_KEYS");
    expect(DUTY_FILES_SOURCE).toMatch(/MANAGED_PROFILE_KEYS\.has\(key\)/);
  });

  it("supports a `run` output mode with no report markers in the body", () => {
    // The schema exposes the `output` enum.
    expect(DUTY_TOOLS_SOURCE).toMatch(
      /output:\s*z[\s\S]*?\.enum\(\[\s*"run"\s*,\s*"report"\s*\]\)/,
    );
    // The body builder dispatches on the resolved output mode.
    expect(DUTY_TOOLS_SOURCE).toContain("resolveOutput");
    expect(DUTY_TOOLS_SOURCE).toContain("buildRunStyleBody");
    expect(DUTY_TOOLS_SOURCE).toContain("buildReportStyleBody");
    // Run-style body MUST NOT contain the report markers that the engine
    // appears to read to route duties.
    const runStyle = extractFunctionSource(
      DUTY_TOOLS_SOURCE,
      "buildRunStyleBody",
    );
    expect(runStyle).not.toContain("Refresh");
    expect(runStyle).not.toContain(".kody/reports/");
    expect(runStyle).not.toContain("report refresh per tick");
    expect(runStyle).not.toContain("Maximum one report refresh");
    // Run-style body still has the structural sections.
    expect(runStyle).toContain("## Job");
    expect(runStyle).toContain("## Allowed Commands");
    expect(runStyle).toContain("## Restrictions");
    // Report-style body keeps the markers (regression check).
    const reportStyle = extractFunctionSource(
      DUTY_TOOLS_SOURCE,
      "buildReportStyleBody",
    );
    expect(reportStyle).toContain("Refresh");
    expect(reportStyle).toContain(".kody/reports/");
    expect(reportStyle).toContain("Maximum one report refresh");
  });

  it("auto-detects `run` output mode when `executables` has 2+ items", () => {
    expect(DUTY_TOOLS_SOURCE).toMatch(
      /executables\.length\s*>\s*1/,
    );
  });
});

/**
 * Slice the source of a top-level `function name(...)` out of a file.
 * Used to inspect the body of a specific helper (e.g. `buildRunStyleBody`)
 * without dragging in surrounding noise.
 */
function extractFunctionSource(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return "";
  // Walk braces from the opening `{` after the parameter list.
  let depth = 0;
  let i = source.indexOf("{", start);
  if (i < 0) return "";
  const openBrace = i;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(openBrace, i + 1);
    }
  }
  return source.slice(openBrace);
}

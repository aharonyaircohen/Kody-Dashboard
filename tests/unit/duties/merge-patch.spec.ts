/**
 * @fileoverview Unit tests for the duty PATCH read-merge helper
 * (src/dashboard/lib/duties/merge-patch.ts). The duty PATCH route uses
 * the "omit preserves, explicit `[]` / `null` clears" contract so the
 * editor can save partial changes without wiping untouched fields.
 * A bug here silently destroys user data on every "Save" — the test
 * pins the contract down.
 */
import { describe, expect, it } from "vitest";
import {
  mergeDutyPatch,
  type DutyMergedFields,
} from "@dashboard/lib/duties/merge-patch";

const existing: DutyMergedFields = {
  mentions: ["alice", "bob"],
  executables: ["research", "plan"],
  dutyTools: ["Bash", "Read"],
  tickScript: 'echo "hello"',
};

describe("mergeDutyPatch — read-merge contract", () => {
  it("preserves every field when the patch is empty (no-op PATCH)", () => {
    expect(mergeDutyPatch(existing, {})).toEqual(existing);
  });

  it("preserves each field individually when only one is omitted", () => {
    // The patch sends one field; every other field must keep its
    // existing value. A bug where a partial patch drops the rest is
    // exactly the data-loss scenario the contract prevents.
    const merged = mergeDutyPatch(existing, { mentions: ["carol"] });
    expect(merged.mentions).toEqual(["carol"]);
    expect(merged.executables).toEqual(existing.executables);
    expect(merged.dutyTools).toEqual(existing.dutyTools);
    expect(merged.tickScript).toBe(existing.tickScript);
  });

  it("clears mentions with an explicit [] (the UI 'no mentions' state)", () => {
    expect(mergeDutyPatch(existing, { mentions: [] }).mentions).toEqual([]);
  });

  it("clears executables with an explicit []", () => {
    expect(mergeDutyPatch(existing, { executables: [] }).executables).toEqual(
      [],
    );
  });

  it("clears dutyTools with an explicit []", () => {
    expect(mergeDutyPatch(existing, { dutyTools: [] }).dutyTools).toEqual([]);
  });

  it("clears tickScript with null", () => {
    expect(
      mergeDutyPatch(existing, { tickScript: null }).tickScript,
    ).toBeNull();
  });

  it("clears tickScript with an empty string (no script = no line)", () => {
    // The editor's textarea submits "" when the field is blank; treat
    // it the same as null so the user can't accidentally preserve a
    // stale value.
    expect(mergeDutyPatch(existing, { tickScript: "" }).tickScript).toBeNull();
  });

  it("normalizes mentions: trims, strips leading @, drops empties", () => {
    // Mirror the frontmatter parser's CSV cleanup so a round-trip
    // through the editor never leaves stray @ or whitespace.
    expect(
      mergeDutyPatch(existing, { mentions: [" @alice ", "@bob", "  "] })
        .mentions,
    ).toEqual(["alice", "bob"]);
  });

  it("normalizes executables: trims and drops empties", () => {
    // The dashboard does not validate executable names — engine
    // built-ins may be valid — so the only cleanup is whitespace +
    // empty-drop. The list never gets coerced to a fixed enum.
    expect(
      mergeDutyPatch(existing, { executables: [" research ", "", "plan"] })
        .executables,
    ).toEqual(["research", "plan"]);
  });

  it("preserves executables of a name the dashboard does not recognize", () => {
    // A user-author's duty may use a future engine built-in that the
    // dashboard does not yet know about. The merge must carry the
    // name through untouched — the engine owns executable validation.
    const merged = mergeDutyPatch(existing, {
      executables: ["qa-verify", "future-builtin-v2"],
    });
    expect(merged.executables).toEqual(["qa-verify", "future-builtin-v2"]);
  });

  it("keeps 'agent tools' (claudeCode.tools) and 'duty tools' (dutyTools) clearly separated", () => {
    // dutyTools lives on TickFile and is the field this helper merges;
    // agent tools (`claudeCode.tools`) live on profile.json. The
    // contract is: this helper only touches the four fields it knows
    // about, never anything else.
    const before: DutyMergedFields = {
      ...existing,
      dutyTools: ["Read", "Write"],
    };
    const after = mergeDutyPatch(before, { mentions: ["x"] });
    expect(after.dutyTools).toEqual(["Read", "Write"]);
  });

  it("replaces tickScript wholesale — the new string fully supersedes the old one", () => {
    expect(
      mergeDutyPatch(existing, { tickScript: 'echo "goodbye"' }).tickScript,
    ).toBe('echo "goodbye"');
  });

  it("preserves a null tickScript (existing never had a script)", () => {
    // When the existing duty has no tickScript (the common case for
    // markdown duties that don't run a preflight script), an empty
    // PATCH must not invent one.
    const noScript: DutyMergedFields = { ...existing, tickScript: null };
    expect(mergeDutyPatch(noScript, {}).tickScript).toBeNull();
  });
});

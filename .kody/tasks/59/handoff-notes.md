# Issue #59 — Duty Editor Simplification

## What was done

Restructured the `ExecutableEditorForm` in `ExecutablesManager.tsx` into a simplified tab layout:

- **Main tab**: slug + prompt + staff picker (the three required fields)
- **Advanced tab** (new): schedule dropdown + mentions input + model + tools checkboxes + landing selector
- **Removed**: Description textarea (auto-derived from prompt's first line on save)
- **Untouched**: Skills, Tools (MCP), Scripts, Review tabs

Also wired `staff`, `every` (schedule cadence), and `mentions` through the full stack:

1. **`ExecutableFields`** in `profile.ts` — added `staff: string | null`, `every: string | null`, `mentions: string[]`
2. **`composeProfile`** — now writes `profile.staff`, `profile.every`, `profile.mentions` to profile.json
3. **`fieldsFromProfile`** — now reads them back for round-trip editing
4. **`files.ts`** — added `every` and `mentions` to `ExecutableSummary` and `ExecutableDetail`
5. **`ExecutableEditorForm`** state — replaced `describe` state with `staff`, `every`, `mentions`; added `StaffSelect`, `ScheduleSelect`, `MentionsInput` components adapted from `DutyControl.tsx`
6. **API schemas** (`route.ts` + `[slug]/route.ts`) — added `staff`, `every`, `mentions` to create/update schemas and `writeExecutableFile` calls
7. **`executable-tools.ts`** — added `staff: null, every: null, mentions: []` defaults to the chat tool path
8. **Test fixture** (`executable-profile-mcp.spec.ts`) — added the three new fields to the `base` fixture

## Key invariant preserved

`describe` is always auto-derived from the prompt's first non-empty line at save time. The stored `profile.describe` always mirrors the prompt's first line. This means existing duties with custom `describe` values will have them overwritten on next edit — see the low-priority followup.

## Acceptance criteria met

- New duty creatable with only slug + prompt + staff
- No Description textarea anywhere in the editor
- List view still shows a one-line summary (auto-derived from prompt)
- Model/tools/schedule/mentions all still editable, under Advanced
- Existing duties load and save without losing model/tools/skills/scripts/mcp config

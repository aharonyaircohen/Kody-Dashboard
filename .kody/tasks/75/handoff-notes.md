Fixed #75: static preview machines can now suspend on idle.

**What changed**

- `src/dashboard/lib/previews/fly-previews.ts` — added `healthCheck?: boolean` to `CreatePreviewMachineInput` (default `false`). The `checks.httpget` block is now gated on it: emitted only when `healthCheck === true`. The pattern mirrors `builder/src/fly-api.ts:189-207` (the builder's `fly.previews.healthCheck` config). Inlined a 3-line comment explaining WHY (a periodic check keeps the machine "active" → autostop never fires).
- `tests/unit/fly-previews.spec.ts` (new) — three cases asserting the gating: default omits the block, `healthCheck: false` omits it, `healthCheck: true` emits the exact 15s-interval block. Mocks `globalThis.fetch`, the same seam `issue-attachments.spec.ts` uses.
- `src/dashboard/lib/previews/static-preview.ts` — no code change. The existing call doesn't pass `healthCheck`, so the new `false` default does the opt-out automatically. Issue said "(or pass false explicitly)" — both options are valid; relying on the default is the smaller diff.

**Why no static-preview.ts edit**

The issue's preferred phrasing was "static previews should not pass it (or pass false explicitly)". Adding a `healthCheck: false` line would have been redundant noise. The default-false approach is the smaller, cleaner change.

**What still needs verification**

The issue asked to "verify with a static preview machine that it transitions to suspended after the idle window". This requires a real Fly org + `FLY_API_TOKEN`; the unit test only proves the request body shape. Filed as a follow-up: run the live integration path against a static preview machine and assert `state === "suspended"` after the idle window.

**Quality gates**: typecheck/lint/format/test all pass.

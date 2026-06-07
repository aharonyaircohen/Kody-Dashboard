# Task 47 — Token-gate per-PR Fly previews (signed ticket + doorman proxy)

## What was implemented

Per-PR Fly preview machines are now gated behind a signed HMAC ticket. The raw
`<app>.fly.dev` URL returns 401 without a valid ticket.

### New files

- `src/dashboard/lib/preview-token.ts` — HKDF-derived key (`kody-preview:v1`) + `mintPreviewTicket()` / `verifyPreviewTicket()`. Mirrors `chat-token.ts` pattern.
- `tests/unit/preview-token.spec.ts` — 14 tests covering key derivation, mint, verify, expiry, tamper, rotation, missing-key.
- `app/api/kody/previews/ticket/route.ts` — Auth-gated GET endpoint (`requireKodyAuth`) returning `{ ticket, expiresAt }`.
- `builder/doorman/doorman.ts` — Tiny Node.js HTTP proxy (port 8080) that verifies `?kp=` tickets, sets `kody_preview_session` cookie, strips the param, proxies to Next.js on 3000. 401 without key or valid ticket.

### Modified files

- `builder/default-Dockerfile.preview.prod` and `builder/default-Dockerfile.preview.dev` — Next.js now runs on port 3000; doorman is PID 1 proxying 8080→3000.
- `src/dashboard/lib/previews/builder-client.ts` — Derives and passes `KODY_PREVIEW_VERIFY_KEY` (hex of HKDF key) to the builder machine as a runtime env var.
- `builder/src/builder.ts` — Passes `KODY_PREVIEW_VERIFY_KEY` to preview machine env; `internal_port` changed from 8080→3000; `postPreviewComment` no longer posts the raw fly.dev URL.
- `app/api/kody/prs/preview/route.ts` — Appends `?kp=<ticket>` to the Fly preview URL returned to the client.
- `docs/previews.md` and `CLAUDE.md` — Updated architecture docs.

### Security design

The raw `KODY_MASTER_KEY` never leaves the dashboard. Only the HKDF-derived 32-byte verify key (`KODY_PREVIEW_VERIFY_KEY`) ships to preview machines via runtime env. The doorman uses this to verify tickets.

### Key follow-ups before this ships

1. **Rebuild the builder image** (`flyctl deploy -c builder/fly.toml --app kody-preview-builder`) so doorman/ is included before the next preview build.
2. **Existing preview machines** need a sync/rebuild to pick up the new internal_port=3000 + doorman port layout.
3. **End-to-end test** with a real Fly preview (raw URL → 401, dashboard → loads correctly).

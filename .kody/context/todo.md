---
staff: []
---

# Open work in Kody

- integrate freellmapi as default (https://github.com/tashfeenahmed/freellmapi)

## Fly previews — security & hardening punch-list

- [ ] **Critical:** Pass only explicitly approved secrets to Fly Previews through an allowlist, never the full repository vault.
- [ ] **High:** Protect every preview with authenticated access or a short-lived token, rather than exposing a public unrestricted URL.
- [ ] **High:** Do not publish open preview links in GitHub comments; links must require authorized access.
- [ ] **High:** Choose one primary preview build path and keep alternative build paths disabled as fallbacks until the main flow is stable.
- [ ] **High:** Freeze non-core extensions for now, including static uploads, PDF previews, and dev-mode previews.
- [ ] **Medium:** Add controlled retries and clear failure reporting for Fly Runner machine creation.
- [ ] **Medium:** Complete one full end-to-end validation flow: task → build → protected preview → approval → merge.
- [ ] **Medium:** Measure actual build times and Fly costs before expanding infrastructure usage.

## Broken duties (no output)

- [ ] **cto — dev-ci-health:** targets a `dev` branch that does not exist in this repo (only `main`). Structurally blocked; produces nothing. Fix or retarget to `main`.
- [ ] **qa — qa-verify:** has no state and verifies zero PRs — no ui-review verdicts, no `kody:ui-verified`/`kody:ui-failed` labels, no merge recommendations. Regressions can ship unseen.

## Long-standing follow-ups

- [ ] Auto-rebuild the per-repo GHCR base on `main` push (today manual → stale → PRs fall back to slow ~15min full installs).
- [ ] Finish the engine state → kody-state migration (still forcing Vercel builds / cost).
- [ ] Sweep and destroy the old 24/7 Fly preview machines (the autostop/suspend fix only applies to newly created machines).
- [ ] Prove the duty idempotent-tools rails (locked-toolbox + ensure_issue/ensure_comment/etc.) — wired but 0 duties use them today.

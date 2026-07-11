# Package Split Plan — kody-chat as the platform, dashboard deprecated

Goal: kody-chat becomes the product base; every dashboard feature ships as a
package on top of it; Kody-Dashboard shrinks to a disposable shell and is then
deleted. Based on a five-way dependency audit (base layer, terminal, Fly,
agency, workspace) run 2026-07-11.

## Target package map

| Package | Contents | Depends on |
| --- | --- | --- |
| `@kody-ade/base` | github-client (core transport only), auth (framework-agnostic), vault, state-repo + engine/config, storage, variables, logger, utils, active-repo + routes, github-contents-write, events (injected scheduler), infrastructure contracts/registry/server-\*, ui kit | — |
| `@kody-ade/kody-chat` | chat core + platform (already a package) | base |
| `@kody-ade/workspace` | context, commands, instructions, brands, todos, memory + their chat tools | base, kody-chat (tools) |
| `@kody-ade/cms` | cms/ (5.7k LOC, own Mongo transport + MCP), content/content-model routes | base |
| `@kody-ade/fly` | infrastructure/plugins/fly, previews/, runners/, preview-token, preview-environments, builder/ (already standalone), fly pages + API | base |
| `@kody-ade/terminal` | terminal core (local-chat-session, checkpoints, directive) | base |
| `@kody-ade/brain` | brain/ runtime control plane (3.9k LOC) | base, terminal, fly |
| `@kody-ade/agency` | agency-runs, goals, capabilities, agents, cto + pages + plugin manifests | base, kody-chat (**peer**) |
| host app (temporary) | Next shell: route mounting, API route wiring, leftover hooks/components | everything |

`company/import.ts` is an aggregator over many features — it stays at the host
(or a thin meta-package) *above* the feature packages, never inside one.
`docs/` (writes consumer README) is excluded from workspace — different backing.

## Blockers found (must fix before/while extracting)

1. **Two god-files.** `api.ts` (2.7k LOC) and `github-client.ts` (4.3k LOC)
   fuse base transport with ~10 features' endpoints (notifications,
   managed-goals, branches, activity, kody-job…). Split: thin core client in
   base, per-feature endpoint modules in their packages. `lib/hooks/` (53
   files) follows the same split.
2. **terminal ↔ brain cycle.** brain imports terminal's bridge-exec-client +
   token; terminal's session-connect imports brain runtime. Fix: push
   bridge-exec-client, terminal-token, bridge-protocol, machine/IP allocation
   down into base; invert session-connect's brain access behind an interface.
3. **GoalControl embeds KodyChat directly** (plus vibe/commands/terminal
   plugins). Agency must treat kody-chat as a peer dependency — or get a
   chat-injection seam.
4. **Fly code bypasses its own abstraction.** previews/runners import
   `plugins/fly/*` directly instead of the infrastructure registry;
   `installed.ts` hard-wires the Fly plugin. Route through the registry.
5. **Next.js value coupling in base candidates.** `auth.ts`
   (NextRequest/NextResponse values), `events/emit.ts` (`after()`),
   `auth-context.tsx` (`usePathname`). Replace with injected adapters; all
   other Next coupling is type-only or guarded.
6. **`utils.ts` imports a feature component** (FilterBar) — sever.
7. **Workspace setup.** `pnpm-workspace.yaml` has no `packages:` globs yet;
   tarball flow must die first.

## Migration order (each step ships green)

1. **One workspace.** Bring kody-chat into a pnpm workspace with the dashboard
   (`packages/` globs). Kill the tarball/`file:` flow. No code moves yet.
2. **Split the god-files.** Carve api.ts + github-client.ts into core
   transport + per-feature endpoint modules, still in place. Fix utils→
   FilterBar. This is the highest-risk step — respect the rate-limit rules
   (ETag/If-None-Match plumbing, cache invalidation) verbatim.
3. **Extract `@kody-ade/base`.** Clean-move set first (logger, vault, storage,
   variables, ui, infrastructure, active-repo, github-contents-write, auth/),
   then the untangled core client, state-repo, auth with request adapters.
   Config via one injected object, not scattered `process.env`.
4. **Repoint kody-chat at base.** Delete the `@dashboard` alias from the
   package. Layering is now correct: base ← kody-chat ← everything else.
5. **Extract `@kody-ade/workspace`** — cleanest feature, proves the pattern
   (thin pages + lib + chat tools per feature, curated `index.ts`).
6. **Extract `@kody-ade/fly`** — first route direct plugin imports through the
   registry, then lift previews/runners/builder.
7. **Break the terminal↔brain cycle**, then extract `@kody-ade/terminal` and
   `@kody-ade/brain` (brain is its own package, not part of agency).
8. **Extract `@kody-ade/agency`** with kody-chat as peer (resolve the
   GoalControl seam here).
9. **Extract `@kody-ade/cms`** (self-contained but big; last because lowest
   coupling risk either way).
10. **Delete the dashboard.** What remains is route mounting + API wiring;
    move that into a kody-chat host app (or generate it), archive the repo.

Rule for every step: a feature is "extracted" only when its code is deleted
from the host and the host builds without it — moving-but-still-imported
does not count.

## Sizes (for planning)

Fly ≈ 13k LOC · agency ≈ 27k (incl. 9.4k components) · brain ≈ 3.9k ·
terminal ≈ 4.9k · workspace ≈ 10k · cms ≈ 5.7k · base clean-move ≈ 12k ·
god-files to split ≈ 7k + 7k hooks. `lib/components/` (63k LOC) splits across
feature packages during steps 5–9.

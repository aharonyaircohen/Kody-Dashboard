/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Lets the assistant answer "what is X in the dashboard?" without
 *  guessing from training data. Static feature catalog + auto-derived entries
 *  for every agent in src/dashboard/lib/agents.ts AND every page in the shared
 *  settings-nav sidebar, so descriptions never drift and new pages teach chat
 *  about themselves automatically.
 */
import { tool } from "ai";
import { z } from "zod";
import { AGENTS, type AgentConfig } from "@dashboard/lib/agents";
import {
  HOME_NAV_ITEM,
  PRIMARY_NAV_ITEMS,
  PRIMARY_NAV_TITLE,
  SETTINGS_NAV_SECTIONS,
  type SettingsNavItem,
} from "@dashboard/lib/components/settings-nav";

export interface FeatureEntry {
  id: string;
  name: string;
  summary: string;
  details: string;
}

const HAND_WRITTEN_FEATURES: FeatureEntry[] = [
  {
    id: "secrets-vault",
    name: "Secrets Vault (/secrets)",
    summary:
      "Per-repo encrypted secrets store. Dashboard-managed alternative to Vercel env vars.",
    details: `The secrets vault is a dashboard-managed alternative to Vercel env vars.

- Each connected repo has its own encrypted blob at \`.kody/secrets.enc\`.
- Values written via the \`/secrets\` page are AES-256-GCM-encrypted with the shared
  \`KODY_MASTER_KEY\` env var and committed back to the repo.
- Runtime code reads values via \`getSecret\` (src/dashboard/lib/vault/get-secret.ts),
  which falls through to \`process.env\` when the vault is missing.
- Bootstrap with \`pnpm vault:init\` to print a fresh key, then paste it into the
  Vercel env. Losing the key means re-entering every secret.
- Engine workflows (\`kody.yml\`) are unchanged — they still read from GitHub
  Actions secrets. The vault is dashboard-runtime only.`,
  },
  {
    id: "webhooks",
    name: "GitHub Webhooks (push-based cache invalidation)",
    summary:
      "Replaces polling for cache invalidation. No shared secret — verifies GitHub IP CIDR ranges.",
    details: `The dashboard receives GitHub webhooks to invalidate its in-memory cache when
issues, PRs, workflow runs, branches, etc. change.

- No shared secret: the receiver verifies the source IP against GitHub's published
  webhook CIDR ranges (cached 24h from \`api.github.com/meta\`). Other sources 403.
- Receiver: \`app/api/webhooks/github/route.ts\` dedupes by \`X-GitHub-Delivery\`
  and dispatches to the matching invalidator.
- Registrar: \`ensureWebhook\` is auto-called from the OAuth callback after login
  (fire-and-forget) and is idempotent.
- Manual re-register: \`POST /api/webhooks/register\`.
- Events: issues, issue_comment, pull_request, pull_request_review,
  pull_request_review_comment, workflow_run, workflow_job, check_run,
  check_suite, push, create, delete.
- Invalidation is per-Vercel-instance — other instances serve cached data until
  their TTL expires (intentional, as a backstop).`,
  },
  {
    id: "chat-backends",
    name: "Chat Backends (three of them)",
    summary:
      "The dashboard has three chat backends picked by selectedAgentId: in-process via Vercel AI Gateway (default), Brain, and the GH Actions engine.",
    details: `The chat UI routes to one of three backends based on \`selectedAgentId\`:

| selectedAgentId | Endpoint                       | Backend                                            |
|-----------------|--------------------------------|----------------------------------------------------|
| \`kody\` (default) | \`/api/kody/chat/kody\`        | In-process via @ai-sdk/gateway (Vercel AI Gateway) |
| \`brain\`         | \`/api/kody/chat/brain\`       | External Brain chat server (proxied SSE)           |
| anything else   | \`/api/kody/chat/trigger\`     | GitHub Actions + \`@kody-ade/kody-engine\`         |

The legacy \`/api/kody/chat\` endpoint is deprecated and returns 410.

Engine path details: dispatches \`kody.yml\` in the connected repo with the
session ID and an inline HMAC token. The engine streams events back to
\`/api/kody/events/ingest\` (real-time) and commits them to
\`.kody/events/{sessionId}.jsonl\` (durable fallback, polled by
\`/api/kody/events/stream\`). Token verified via HMAC of sessionId with
\`KODY_MASTER_KEY\` (purpose-prefixed as \`kody-chat-token:\${KODY_MASTER_KEY}\`).`,
  },
  {
    id: "pipeline-stages",
    name: "Kody Pipeline Stages",
    summary:
      "Spec phase: taskify → spec → clarify. Impl phase: architect → plan-review → build → commit → verify → pr. Special: autofix retry loop.",
    details: `The Kody pipeline runs in GitHub Actions and has these stages:

**Spec phase**
- \`taskify\` — turn an issue into a structured task
- \`spec\` — write the spec
- \`clarify\` — ask blocking clarification questions

**Impl phase**
- \`architect\` — design the technical approach
- \`plan-review\` — review the plan
- \`build\` — implement
- \`commit\` — commit changes
- \`verify\` — run tests / type checks
- \`pr\` — open the pull request

**Special**
- \`autofix\` — retry loop for failing CI

Each stage's status is committed to a per-task \`status.json\` on the work branch.`,
  },
  {
    id: "kody-duties",
    name: "Kody Duties (scheduled markdown duties)",
    summary:
      "Markdown files at .kody/duties/<slug>.md that the engine job-scheduler ticks every 5 minutes.",
    details: `A Kody Duty is a markdown file at \`.kody/duties/<slug>.md\` that the engine's
job-scheduler ticks every 5 minutes. Each duty's own \`Cadence guard\` decides
whether to take action on a given tick.

Format (must match existing duties in \`.kody/duties/\`):
- H1 title
- \`## Job\` — purpose (the engine's job-tick executor parses this heading, so its text stays literal)
- \`## Allowed Commands\`
- \`## Restrictions\`
- \`## State\`

Default template is REPORT-PRODUCER: each active tick gathers inputs, composes
a YAML \`findings:\` report, and commits it to
\`kody-state:.kody/reports/<slug>.md\` via \`gh api PUT\` (the job-tick
executable only has Bash + Read tools — reports are committed via the contents
API, not the working tree).

The chat exposes the \`create_kody_duty\` tool to scaffold a new duty after a
gap-analysis conversation.`,
  },
  {
    id: "kody-staff",
    name: "Kody Staff (reusable persona files)",
    summary:
      "Markdown files at .kody/staff/<slug>.md — pure reusable personas.",
    details: `A Kody Staff member is a markdown file at \`.kody/staff/<slug>.md\`. A
staff member is a pure reusable PERSONA — a markdown body describing intent,
allowed commands, and restrictions. Staff have NO schedule, NO state,
and NO run/tick; they're personas referenced by other flows. The Staff
page is a pure persona editor (list / view / create / edit / delete).

Format (must match existing staff in \`.kody/staff/\`):
- H1 title
- \`## Staff\` — purpose / persona
- \`## Allowed Commands\`
- \`## Restrictions\`

The chat exposes the \`create_kody_staff\` tool to scaffold a new staff
persona after a gap-analysis conversation.`,
  },
  {
    id: "memory",
    name: "Persistent Memory System",
    summary:
      'Per-repo memory at .kody/memory/. Index injected into every chat turn under "Remembered context".',
    details: `Each connected repo has a persistent memory system at \`.kody/memory/\`.

- Memories are markdown files at \`.kody/memory/<id>.md\` (one per entry).
- Types: \`feedback\`, \`project\`, \`reference\`, \`user\`.
- An \`INDEX.md\` is injected into every chat turn under "## Remembered context"
  so the assistant can apply relevant entries automatically.

Chat tools:
- \`remember\` — write a new entry
- \`update_memory\` — revise one
- \`forget\` — delete one
- \`recall(id)\` — fetch the full body when the one-line hook isn't enough
- \`recall_search(query)\` — full-text search every memory body via GitHub
  code search (when the keyword lives in a body)
- \`list_memories\` — enumerate all of them

Bootstrap rule: until the repo has 5 memory entries, the assistant only writes
when the user explicitly asks ("remember that…", "save this") or has just
clearly corrected/confirmed something.`,
  },
  {
    id: "task-dashboard",
    name: "Task Dashboard (main page)",
    summary:
      "Lists Kody tasks, pipeline stage progress, and associated PRs/workflow runs.",
    details: `The main dashboard page lists Kody tasks driven by GitHub issues.

- Each task row shows pipeline stage progress, the latest workflow run, and any
  linked PR.
- Cache invalidation is push-driven via webhooks (see \`webhooks\` feature).
- Polled endpoints respect strict GitHub rate-limit rules (see CLAUDE.md):
  the polling token is shared across all dashboard users (5000 REST req/hr),
  so cache misses must go through ETag/\`If-None-Match\` and writes must call
  \`invalidateIssueCache(n)\`.
- Polling cadence is ≥ 15s on every endpoint that touches GitHub.`,
  },
  {
    id: "remote-dev",
    name: "Remote Dev (user's own Mac)",
    summary:
      "Optional: lets Kody run shell, read, write, and ls on the user's remote Mac dev machine.",
    details: `When a user has configured a remote dev environment, the chat exposes four
extra tools that run against the user's own Mac:

- \`remote_exec\` — shell commands (30s timeout, 512KB output cap)
- \`remote_read\` — read file contents (1MB limit)
- \`remote_write\` — write files (destructive — assistant must confirm first)
- \`remote_ls\` — list directory contents

Commands run with the user's local permissions. The assistant always confirms
before destructive operations.`,
  },
  {
    id: "voice-modality",
    name: "Voice Modality",
    summary:
      "Speech-to-text input + text-to-speech output layered onto the regular Kody chat. Keeps whichever agent the user picked in the dropdown — only the reply shape changes.",
    details: `Voice is a modality, not a separate agent dropdown. Toggling the mic in
KodyChat:

- Streams mic audio to a speech-to-text provider, which transcribes utterances
  into chat messages.
- Routes those messages to \`/api/kody/chat/kody\` with the user's selected
  \`agentId\` plus \`voiceMode: true\`. The server appends a voice overlay
  (no markdown, short sentences, symbols read aloud as words) to that agent's
  system prompt — so the selected agent's brain and tools stay in charge,
  only the output shape changes.
- Streams the reply text to a text-to-speech provider that speaks it back.

If a model in /models is flagged as the speech model, voice prefers it for
latency. Otherwise voice uses whichever model is currently selected for chat.`,
  },
];

function featureFromAgent(agent: AgentConfig): FeatureEntry {
  const id = `agent:${agent.id}`;
  const capabilities = agent.capabilities.length
    ? `\n\n**Capabilities**\n${agent.capabilities.map((c) => `- ${c}`).join("\n")}`
    : "";
  return {
    id,
    name: `Agent: ${agent.name}`,
    summary: agent.description,
    details: `${agent.description}${capabilities}`,
  };
}

/**
 * Nav pages whose concept is already described by a richer hand-written entry
 * above. We skip auto-deriving these so there's one canonical answer per
 * concept (the deep one wins). Keyed by exact nav href.
 */
const NAV_HREF_TO_HANDWRITTEN: Readonly<Record<string, string>> = {
  "/": "task-dashboard",
  "/secrets": "secrets-vault",
  "/duties": "kody-duties",
  "/staff": "kody-staff",
};

function kebab(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function featureFromNav(item: SettingsNavItem, section: string): FeatureEntry {
  const desc = item.description?.trim() ?? "";
  return {
    id: `page:${kebab(item.label)}`,
    name: `${item.label} (${item.href})`,
    summary: desc || `The ${item.label} page.`,
    details:
      `The ${item.label} page lives under the "${section}" group of the sidebar.\n\n` +
      `Route: \`${item.href}\`` +
      (desc ? `\n\n${desc}` : ""),
  };
}

function buildNavEntries(): FeatureEntry[] {
  const sourced: { item: SettingsNavItem; section: string }[] = [
    { item: HOME_NAV_ITEM, section: PRIMARY_NAV_TITLE },
    ...PRIMARY_NAV_ITEMS.map((item) => ({ item, section: PRIMARY_NAV_TITLE })),
    ...SETTINGS_NAV_SECTIONS.flatMap((s) =>
      s.items.map((item) => ({ item, section: s.title })),
    ),
  ];

  const seen = new Set<string>();
  const entries: FeatureEntry[] = [];
  for (const { item, section } of sourced) {
    if (NAV_HREF_TO_HANDWRITTEN[item.href]) continue; // covered by a deeper entry
    const entry = featureFromNav(item, section);
    if (seen.has(entry.id)) continue; // dedupe duplicate labels
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

function buildCatalog(): FeatureEntry[] {
  const agentEntries = Object.values(AGENTS).map(featureFromAgent);
  const navEntries = buildNavEntries();
  return [...HAND_WRITTEN_FEATURES, ...navEntries, ...agentEntries];
}

const CATALOG: ReadonlyArray<FeatureEntry> = buildCatalog();
const CATALOG_BY_ID = new Map(
  CATALOG.map((entry) => [entry.id.toLowerCase(), entry]),
);

export const listDashboardFeaturesTool = tool({
  description:
    "List every dashboard feature, page, and agent this assistant can describe. " +
    "Returns id, name, and one-line summary for each entry. Call this first when " +
    'the user asks "what can the dashboard do" or you do not know which feature ' +
    "id to pass to describe_feature.",
  inputSchema: z.object({}),
  execute: async () => {
    return {
      features: CATALOG.map(({ id, name, summary }) => ({ id, name, summary })),
    };
  },
});

export const describeFeatureTool = tool({
  description:
    "Return the full description of one dashboard feature (page, agent, vault, " +
    'webhooks, pipeline, etc.). Use when the user asks "what is X?", "how does X ' +
    'work?", or "what can <agent> do?". Call list_dashboard_features first if you ' +
    "do not know the exact id.",
  inputSchema: z.object({
    id: z
      .string()
      .min(1)
      .describe(
        'Feature id from list_dashboard_features (e.g. "secrets-vault", ' +
          '"webhooks", "agent:kody-live"). Case-insensitive.',
      ),
  }),
  execute: async ({ id }) => {
    const entry = CATALOG_BY_ID.get(id.toLowerCase());
    if (!entry) {
      return {
        error: `Unknown feature id "${id}". Call list_dashboard_features to see valid ids.`,
      };
    }
    return entry;
  },
});

export const featureTools = {
  list_dashboard_features: listDashboardFeaturesTool,
  describe_feature: describeFeatureTool,
};

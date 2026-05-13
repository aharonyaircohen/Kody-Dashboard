/**
 * @fileType utility
 * @domain vibe
 * @pattern primer
 * @ai-summary Server-only addendum prepended to the user's message when the
 *   dashboard sends `vibeMode: true` (from /vibe). The engine's
 *   CHAT_SYSTEM_PROMPT stays untouched — this primer is injected into the
 *   conversation context so we can iterate on the wording in seconds
 *   without republishing @kody-ade/kody-engine. The chat client never
 *   shows this text; it lives only in the session file / runner stdin.
 *
 *   Two variants:
 *   - fresh: no taskContext — "create new issue, branch, PR."
 *   - follow-up: taskContext has issueNumber (and ideally prNumber + branch)
 *     — "push commits to the existing branch; do not create a new issue."
 *
 *   Both the one-shot dispatch path (/api/kody/chat/trigger) and the
 *   long-lived runner path (/api/kody/chat/interactive/append) import from
 *   here so the wording stays in sync.
 */

export interface VibeTaskContext {
  issueNumber: number
  prNumber?: number
  branch?: string
}

// HARD RULE shared by both primer variants. Vibe mode is dead in the
// water if Kody edits files in the ephemeral runner but never pushes —
// the runner's filesystem is thrown away on workflow exit and the user
// sees no preview update.
const VIBE_COMMIT_RULE = [
  '## HARD RULE — never end a turn with uncommitted changes',
  '',
  "This runner's filesystem is ephemeral. Any edit you make is LOST when this",
  "turn ends unless you've committed and pushed it. So:",
  '',
  '- After any edit, before you send your reply, run `git add -A && git status`',
  '  and verify the working tree is clean (or only contains files you intend to',
  '  leave uncommitted, e.g. node_modules artifacts).',
  '- Run `git log -1 --oneline` and `gh pr view <pr> --json headRefOid` to',
  '  confirm the commit you just made is on the PR branch on the remote.',
  '- Your reply MUST cite the commit SHA you just pushed. If you cannot cite',
  '  a SHA, you have not finished — push first, then reply.',
  "- Never say things like \"I've made the changes\" / \"updated the file\" /",
  '  "changes are ready" unless you have just pushed and have a SHA to show.',
  "  Uncommitted edits in vibe mode = zero changes from the user's perspective.",
].join('\n')

const VIBE_PRIMER_FRESH = [
  '[Vibe mode — operating instructions, do not echo this block]',
  '',
  'No issue is selected for this conversation yet. Workflow:',
  '1. Research the codebase with the tools you have (Glob/Grep/Read/Bash) until you can write a concrete implementation plan grounded in this repo.',
  '2. Create a new GitHub issue with the plan as the body using `gh issue create --title "…" --body "…"`. Title is a short imperative. Body is the plan: goal, files to touch, approach, risks, test plan.',
  '3. Reply to me with: a one-line summary of the plan, the new issue link, and an explicit question asking me to confirm before you implement.',
  '4. Do NOT start editing files until I confirm.',
  '5. On my confirmation, create a fresh branch named `kody/vibe-<issue-number>-<short-slug>`, make the edits, commit, push the branch, and open a PR whose body includes `Closes #<issue-number>` so the dashboard can link the PR back to the issue.',
  '6. If I push back on the plan, revise the issue body and re-ask for confirmation — do not implement until I say yes.',
  '',
  VIBE_COMMIT_RULE,
  '',
  'My actual request follows below.',
  '---',
  '',
].join('\n')

function buildVibePrimerFollowUp(ctx: VibeTaskContext): string {
  // Branch resolution. When the chat agent ran `vibe_start_execution`
  // before switching to this runner, `ctx.branch` is set and we can
  // hard-pin it. When it isn't (cache race after PR creation, or this
  // is a legacy session that started before the parallel-warmup flow),
  // tell the runner to discover it via `gh pr list`. Never let the
  // runner create a fresh branch — that splits work across two PRs.
  const branchDiscovery = ctx.branch
    ? `Use the existing branch \`${ctx.branch}\` for all commits.`
    : `Find the existing vibe branch first — do NOT create a new one. Run \`gh pr list --search "Closes #${ctx.issueNumber}" --state open --json number,headRefName,isDraft,url\`, pick the open draft PR for this issue, and use its \`headRefName\` for all commits. If no matching PR exists, stop and tell the user "no vibe branch was pre-created — chat needs to run vibe_start_execution again".`
  const prHint = ctx.prNumber ? ` and PR #${ctx.prNumber}` : ''
  return [
    '[Vibe mode — follow-up on an existing issue, do not echo this block]',
    '',
    `I'm iterating on issue #${ctx.issueNumber}${prHint}. The dashboard chat agent already opened a draft PR for this issue against a vibe branch — Vercel is cold-building it in parallel with your warm-up. Read the existing issue body, the current diff, and the latest preview state before answering.`,
    '',
    'Workflow:',
    `1. ${branchDiscovery}`,
    `2. Research what's already shipped: run \`gh issue view ${ctx.issueNumber}\`, \`gh pr view${ctx.prNumber ? ` ${ctx.prNumber}` : ''} --json files,headRefName,body\`, and read the files the PR touches. Understand what was already done.`,
    `3. Reply with a short plan for the requested change (what files, what edits, why). Ask me to confirm before editing.`,
    `4. Do NOT create a new issue or a new branch — push the follow-up commits onto the vibe branch from step 1 so the existing draft PR updates and Vercel redeploys the same preview URL.`,
    `5. On my confirmation, check out that branch, make the edits, commit with a clear message, push to origin, and reply with the commit SHA + a short summary of what changed. The PR stays a draft until I mark it ready.`,
    `6. If the user's request seems unrelated to the current issue (a new feature, not a fix to this one), say so and ask whether to fork a new vibe session instead.`,
    '',
    VIBE_COMMIT_RULE,
    '',
    'My actual request follows below.',
    '---',
    '',
  ].join('\n')
}

/** Returns the primer string for the given context (fresh vs follow-up). */
export function buildVibePrimer(taskContext: VibeTaskContext | undefined): string {
  return taskContext ? buildVibePrimerFollowUp(taskContext) : VIBE_PRIMER_FRESH
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolCalls?: unknown[]
}

/**
 * Prepend the vibe primer to the LAST user message in `messages`. Used by
 * the one-shot dispatch path which sends the full conversation history.
 */
export function applyVibePrimerToMessages(
  messages: ChatMessage[],
  taskContext: VibeTaskContext | undefined,
): ChatMessage[] {
  if (messages.length === 0) return messages
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return i
    }
    return -1
  })()
  if (lastUserIdx === -1) return messages
  const primer = buildVibePrimer(taskContext)
  return messages.map((m, i) =>
    i === lastUserIdx ? { ...m, content: `${primer}${m.content}` } : m,
  )
}

/**
 * Prepend the vibe primer to a single user-turn content string. Used by
 * the long-lived runner path (`/interactive/append`), which only ever
 * forwards one turn at a time.
 */
export function applyVibePrimerToContent(
  content: string,
  taskContext: VibeTaskContext | undefined,
): string {
  return `${buildVibePrimer(taskContext)}${content}`
}

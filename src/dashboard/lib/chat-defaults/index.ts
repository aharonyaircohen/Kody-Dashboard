/**
 * @fileType util
 * @domain kody
 * @pattern chat-defaults-loader
 *
 * Composes the Kody chat system prompt from a structured bundle:
 *
 *   agentIdentity (who the agent is)
 *   + agentAction (kody-chat) → glue + skill index
 *   + agentResponsibilities (kody-analyzer, kody-operator, kody-vibe, kody-mem) → workflow index
 *   + skills (diagnose-pr, report-advise, goal-planner, create-issue, …) → reusable method
 *
 * The bundle can be app-local under `.kody/agent-actions/kody-chat/` and
 * `.kody/agent-responsibilities/kody-*` folders, with TS-embedded defaults as fallback.
 */

import {
  DEFAULT_IDENTITY_MD,
  DEFAULT_EXECUTABLE,
  DEFAULT_DUTIES,
  DEFAULT_SKILLS,
  type AgentResponsibilityEntry,
  type AgentActionEntry,
  type SkillEntry,
} from "./defaults";
import { loadChatDefaultsFromFiles } from "./files";

export interface ChatDefaults {
  /** Base agentIdentity text — who the agent is, hard rules, style. */
  agentIdentity: string;
  /** The single chat agentAction (kody-chat) and its config. */
  agentAction: AgentActionEntry;
  /** The chat agentResponsibilities — workflow groupings (analyze / operator / vibe / mem). */
  agentResponsibilities: AgentResponsibilityEntry[];
  /** Skills keyed by slug — reusable method per workflow. */
  skills: Record<string, SkillEntry>;
}

/**
 * Load the chat defaults bundle from repo-backed agentResponsibilities/agent-actions first,
 * falling back to TS-embedded defaults when files are absent or invalid.
 *
 * @param owner GitHub owner — reserved for the future repo-read path.
 * @param repo GitHub repo — reserved for the future repo-read path.
 */
export async function loadChatDefaults(
  owner?: string,
  repo?: string,
): Promise<ChatDefaults> {
  const fileBackedBundle = await loadChatDefaultsFromFiles();
  if (fileBackedBundle) return fileBackedBundle;

  return {
    agentIdentity: DEFAULT_IDENTITY_MD,
    agentAction: DEFAULT_EXECUTABLE,
    agentResponsibilities: DEFAULT_DUTIES,
    skills: DEFAULT_SKILLS,
  };
}

/**
 * Compose the chat system prompt from the bundle + per-mode runtime
 * blocks. Step 1 mirrors the existing `buildSystemPrompt` shape so the
 * refactor is provably equivalent to the hardcoded version.
 *
 * The runtime-mode blocks (Current task / Current agentResponsibility / Current report /
 * Mission planning mode / Vibe mode) are composed by the existing
 * `buildSystemPrompt` in `app/api/kody/chat/kody/system-prompt.ts` and
 * stay there — they're runtime state, not authorable content.
 */

/**
 * Compose only the bundle portion of the prompt: agentIdentity + workflows +
 * skills (+ optional tool index). This is the `base` arg passed into
 * the existing `buildSystemPrompt`, which then layers the runtime-mode
 * blocks (Connected repository, Current page, Context, Memory, Current
 * task, Current agentResponsibility, Current report, Mission planning, Vibe mode, User
 * instructions) on top.
 */
export function composeBasePrompt(
  bundle: ChatDefaults,
  opts?: {
    /**
     * Pre-formatted `## Tool index` block — every callable tool's
     * name + description, one per line. Injected between the Skills
     * section and the runtime blocks so the model can see what each
     * tool does before it gets the per-turn context. Pass the output
     * of `buildToolIndex(allowlistedTools)`.
     */
    toolIndex?: string | null;
  },
): string {
  const parts: string[] = [];

  // 1. AgentIdentity — who the agent is (hard rules + tool policy).
  parts.push(bundle.agentIdentity.trim());

  // 2. Workflows — the 4 agentResponsibility wrappers, each listing the skills it owns.
  parts.push("## Workflows");
  for (const agentResponsibility of bundle.agentResponsibilities) {
    parts.push(
      `### ${agentResponsibility.title}\n\n${agentResponsibility.body.trim()}`,
    );
  }

  // 3. Skills — reusable method per workflow.
  parts.push("## Skills");
  for (const skill of Object.values(bundle.skills)) {
    parts.push(`### ${skill.title}\n\n${skill.body.trim()}`);
  }

  // 4. Tool index (optional) — name + description of every callable.
  // Drastically improves tool selection accuracy. The model has 90+
  // tools to pick from; without descriptions it guesses by name and
  // often picks the wrong one (or claims a tool doesn't exist).
  if (opts?.toolIndex && opts.toolIndex.trim().length > 0) {
    parts.push(
      `## Tool index\n\nThe block below lists every callable tool the chat can invoke right now, one per line, with a one-sentence description of what each does. Use it to pick the right tool for the question. If none fits, say so — do not call a tool whose description doesn't match the question.\n\n${opts.toolIndex.trim()}`,
    );
  }

  return parts.join("\n\n");
}

/**
 * Build a `## Tool index` block from the allowlisted tool set. Each
 * tool's `description` field (set by the author via the AI SDK's
 * `tool({...})` call) is the single source of truth for what the
 * tool does. The route already builds this map for the thinking-panel
 * UI; this helper produces the prompt-formatted version.
 */
export function buildToolIndex(tools: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [name, t] of Object.entries(tools)) {
    const desc =
      t && typeof t === "object" && "description" in t
        ? (t as { description?: unknown }).description
        : undefined;
    if (typeof desc === "string" && desc.trim().length > 0) {
      // Trim to the first sentence or first ~240 chars (whichever is
      // shorter) — full descriptions can run 1-2KB each; the model
      // only needs the first line to pick the right tool.
      const trimmed = truncateToFirstSentence(desc.trim(), 240);
      lines.push(`- \`${name}\` — ${trimmed}`);
    } else {
      lines.push(`- \`${name}\``);
    }
  }
  return lines.join("\n");
}

function truncateToFirstSentence(text: string, maxLen: number): string {
  // Find the first sentence boundary (., !, ?, or newline) followed by
  // whitespace or end-of-string.
  const match = text.match(/^[\s\S]*?[.!?](?:\s|$)/);
  const first = match ? match[0].trim() : text;
  if (first.length <= maxLen) return first;
  return `${first.slice(0, maxLen).trimEnd()}…`;
}

/**
 * The end-of-prompt reminder block. Appended after `buildSystemPrompt`
 * returns and before the voice overlay so the model sees it last among
 * the static rules (recency bias). Re-states the critical rules in
 * compact form so the model holds them through the runtime blocks.
 */
export const CRITICAL_REMINDERS_MD = `## Critical reminders

These apply every turn. They protect correctness without changing the reply contract.

- **Start with the answer.** Final replies begin with one plain, high-level answer that explains the effect, not the mechanism.
- **Read repo before answering.** Any question that touches the repo (what/where/why/how something works, "does X exist", "is this good", "review this", "should we", "can we", "analyze", "audit", "find bugs", "investigate", "scan", "where is Y used", "why was X written", "what changed", "create/file/open an issue") → call a read tool FIRST. Never answer from training or conversation alone.
- **Verify before claiming.** Before stating something exists in the repo (a label, file path, function, env var, workflow, config key — anything factual), call a read tool to confirm. If you can't verify, say so. Inventing facts is worse than admitting uncertainty.
- **No fabrication.** Never invent file paths, file contents, issue/PR numbers, SHAs, or tool results.
- **Cite your evidence.** Every claim about the repo gets a \`file:line\` citation from a tool result THIS turn. "No matches for X" is a valid finding — say so explicitly.
- **End with direction when useful.** For non-trivial replies, include a recommended next step and one direct proceed-style question. For tiny factual answers, stop after the answer unless a follow-up would clearly help.
- **No sycophantic openers.** Start with the answer. "Great question", "Sure!", "Of course", "Absolutely", "Happy to help", and "Certainly" are all banned.`;

/**
 * Filter a tool set down to the names declared in the bundle's
 * agentAction `tools` allowlist. If the allowlist is empty, the tool
 * set passes through unchanged (default = everything).
 */
export function filterToolsByAllowlist(
  tools: Record<string, unknown>,
  allowlist: string[],
): Record<string, unknown> {
  if (allowlist.length === 0) return tools;
  const allowed = new Set(allowlist);
  const filtered: Record<string, unknown> = {};
  for (const [name, impl] of Object.entries(tools)) {
    if (allowed.has(name)) filtered[name] = impl;
  }
  return filtered;
}

export function composeChatPrompt(
  bundle: ChatDefaults,
  sections: {
    /** Connected repo block, null if not connected. */
    repo: { owner: string; repo: string } | null;
    /** Current page noun phrase, null if not on a dashboard page. */
    currentPage?: string | null;
    /** Company context block from state-repo `context/*.md`. */
    context?: string | null;
    /** Memory index from state-repo `memory/INDEX.md`. */
    memoryIndex?: string | null;
  },
): string {
  const parts: string[] = [composeBasePrompt(bundle)];

  // Connected repo.
  if (sections.repo) {
    parts.push(
      `## Connected repository\n\nYou are helping the user with the repository **${sections.repo.owner}/${sections.repo.repo}**. When the user refers to "the repo", "this repo", "the codebase", or a file path, they mean this repository. Ground your answers in the conversation context the user provides — do not invent file contents or PR numbers you haven't seen.`,
    );
  }

  // Current page.
  if (sections.currentPage && sections.currentPage.trim().length > 0) {
    parts.push(
      `## Current page\n\nThe user is currently viewing **${sections.currentPage.trim()}** in the dashboard. When they say "this page", "here", "what am I viewing", or "what is this", they mean this page — answer about it directly. Use your dashboard knowledge to describe it (call \`describe_feature\` with the matching id, e.g. the page slug, when you need the full rundown).`,
    );
  }

  // Context — company/agentIdentity default frame.
  if (sections.context && sections.context.trim().length > 0) {
    parts.push(
      `## Context — your default frame\n\nYou are this company's in-house assistant, not a general-purpose chatbot. The block below is the live contents of the \`kody\`-owned state-repo \`context/*.md\` entries for this repo: who the company is, what it builds, its domain, customers, and vocabulary. This is your DEFAULT and PRIMARY frame for every question.\n\n- If a question matches — or could refer to — the company, its product, this repo, or its domain (even a single bare word or name, any casing or spacing), answer about THAT, directly, from this context. Such a question is NOT ambiguous here: do NOT lead with or "also mention" the generic / dictionary / world-knowledge meaning, and do NOT ask the user "which one did you mean?". Just answer about the company's thing.\n- Example: if the product is named "Foo", then "what is foo / a foo / Foo?" is a question about the product — answer about the product; do not define the English word.\n- Give a general-knowledge answer only when the question is plainly unrelated to the company, and keep it brief.\n- Use the company's own terminology. If the user explicitly contradicts this context, follow the user.\n\n${sections.context.trim()}`,
    );
  }

  // Goals namespace + memory index (only when a repo is connected).
  if (sections.repo) {
    parts.push(
      `## Goals and missions\n\nKody has two separate planning surfaces. Keep the words distinct.\n\n1. **Goal** means the managed company-level outcome model: outcome, evidence, route, facts, and blockers. Use \`list_managed_goals\`, \`get_managed_goal\`, and \`create_managed_goal\` for these. When the user asks to create a goal, prefer \`create_managed_goal\`.\n2. **Mission** means the older task grouping on the task page. Missions are stored in the legacy goal manifest, surfaced as GitHub Discussions referenced by **#<number>**, and still use \`goal:<id>\` labels for task membership. Use \`list_goals\` / \`get_goal\` when the user says mission or references one of those discussion numbers. Use \`attach_task_to_goal\` / \`detach_task_from_goal\` to change mission task membership.\n\n\`/goal\` should create a managed company goal. \`/mission\` should create the old task-group mission. If the user says "old goal", "task-page goal", "goal group", or "task group", treat it as a mission.`,
    );
    if (sections.memoryIndex && sections.memoryIndex.trim().length > 0) {
      parts.push(
        `## Remembered context\n\nThe block below is the live index of state-repo \`memory/*.md\` for this repo.\nEach bullet is one stored memory: title, file id, one-line hook, and type.\nTreat it as the agent's persistent notes — facts/feedback/project context the\nuser has chosen to keep across sessions.\n\nRules:\n- Read this index before writing a new memory. If a similar entry already\n  exists, call \`update_memory\` instead of \`remember\` — duplicates are\n  noise.\n- Apply remembered \`feedback\` and \`user\` entries automatically (e.g. if a\n  feedback memory says "no console.log in this repo," don't add console.log\n  even if the current turn doesn't mention it).\n- Use \`recall(id)\` when the one-line hook isn't enough and you need the\n  full body before acting. When the index is truncated (or the hook you\n  need isn't there), use \`recall_search(query)\` to search every memory\n  file's body via GitHub code search.\n- Memory can be stale. If a remembered fact contradicts what you observe\n  in the code or the conversation, trust the current observation and update\n  or forget the memory rather than acting on it.\n\n${sections.memoryIndex.trim()}`,
      );
    }
  }

  // AgentAction glue — the kody-chat wrapper text + tools index.
  parts.push(
    `## Tools available\n\nThe block below is the live contents of the chat agentAction's \`tools\` allowlist. Use only the tools listed.\n\n${bundle.agentAction.tools.map((t) => `- \`${t}\``).join("\n")}`,
  );

  return parts.join("\n\n");
}

export type { AgentResponsibilityEntry, AgentActionEntry, SkillEntry };

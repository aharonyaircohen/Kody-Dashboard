/**
 * @fileType util
 * @domain kody
 * @pattern chat-defaults-loader
 *
 * Composes the Kody chat system prompt from a structured bundle:
 *
 *   persona (who the agent is)
 *   + executable (kody-chat) → glue + skill index
 *   + duties (kody-analyzer, kody-operator, kody-vibe, kody-mem) → workflow index
 *   + skills (diagnose-pr, report-advise, goal-planner, create-issue, …) → reusable method
 *
 * The bundle is repo-stored (`.kody/chat/defaults/`) with a TS-embedded
 * default as fallback. Step 1 returns the TS defaults only; the repo read
 * is gated on a future flag so existing chat behavior is unchanged.
 */

import {
  DEFAULT_PERSONA_MD,
  DEFAULT_EXECUTABLE,
  DEFAULT_DUTIES,
  DEFAULT_SKILLS,
  type DutyEntry,
  type ExecutableEntry,
  type SkillEntry,
} from "./defaults";

export interface ChatDefaults {
  /** Base persona text — who the agent is, hard rules, style. */
  persona: string;
  /** The single chat executable (kody-chat) and its config. */
  executable: ExecutableEntry;
  /** The chat duties — workflow groupings (analyze / operator / vibe / mem). */
  duties: DutyEntry[];
  /** Skills keyed by slug — reusable method per workflow. */
  skills: Record<string, SkillEntry>;
}

/**
 * Load the chat defaults bundle. Step 1 returns the TS-embedded defaults
 * only; the repo read will be added in step 2 and gated by an env flag.
 *
 * @param owner GitHub owner — reserved for the future repo-read path.
 * @param repo GitHub repo — reserved for the future repo-read path.
 */
export async function loadChatDefaults(
  owner?: string,
  repo?: string,
): Promise<ChatDefaults> {
  return {
    persona: DEFAULT_PERSONA_MD,
    executable: DEFAULT_EXECUTABLE,
    duties: DEFAULT_DUTIES,
    skills: DEFAULT_SKILLS,
  };
}

/**
 * Compose the chat system prompt from the bundle + per-mode runtime
 * blocks. Step 1 mirrors the existing `buildSystemPrompt` shape so the
 * refactor is provably equivalent to the hardcoded version.
 *
 * The runtime-mode blocks (Current task / Current duty / Current report /
 * Goal planning mode / Vibe mode) are composed by the existing
 * `buildSystemPrompt` in `app/api/kody/chat/kody/system-prompt.ts` and
 * stay there — they're runtime state, not authorable content.
 */

/**
 * Compose only the bundle portion of the prompt: persona + workflows +
 * skills. This is the `base` arg passed into the existing
 * `buildSystemPrompt`, which then layers the runtime-mode blocks
 * (Connected repository, Current page, Context, Memory, Current task,
 * Current duty, Current report, Goal planning, Vibe mode, User
 * instructions) on top.
 */
export function composeBasePrompt(bundle: ChatDefaults): string {
  const parts: string[] = [];

  // 1. Persona — who the agent is (hard rules + tool policy).
  parts.push(bundle.persona.trim());

  // 2. Workflows — the 4 duty wrappers, each listing the skills it owns.
  parts.push("## Workflows");
  for (const duty of bundle.duties) {
    parts.push(`### ${duty.title}\n\n${duty.body.trim()}`);
  }

  // 3. Skills — reusable method per workflow.
  parts.push("## Skills");
  for (const skill of Object.values(bundle.skills)) {
    parts.push(`### ${skill.title}\n\n${skill.body.trim()}`);
  }

  return parts.join("\n\n");
}

/**
 * Filter a tool set down to the names declared in the bundle's
 * executable `tools` allowlist. If the allowlist is empty, the tool
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
    /** Company context block from `.kody/context/*.md`. */
    context?: string | null;
    /** Memory index from `.kody/memory/INDEX.md`. */
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

  // Context — company/persona default frame.
  if (sections.context && sections.context.trim().length > 0) {
    parts.push(
      `## Context — your default frame\n\nYou are this company's in-house assistant, not a general-purpose chatbot. The block below is the live contents of the \`kody\`-owned \`.kody/context/*.md\` entries for this repo: who the company is, what it builds, its domain, customers, and vocabulary. This is your DEFAULT and PRIMARY frame for every question.\n\n- If a question matches — or could refer to — the company, its product, this repo, or its domain (even a single bare word or name, any casing or spacing), answer about THAT, directly, from this context. Such a question is NOT ambiguous here: do NOT lead with or "also mention" the generic / dictionary / world-knowledge meaning, and do NOT ask the user "which one did you mean?". Just answer about the company's thing.\n- Example: if the product is named "Foo", then "what is foo / a foo / Foo?" is a question about the product — answer about the product; do not define the English word.\n- Give a general-knowledge answer only when the question is plainly unrelated to the company, and keep it brief.\n- Use the company's own terminology. If the user explicitly contradicts this context, follow the user.\n\n${sections.context.trim()}`,
    );
  }

  // Goals namespace + memory index (only when a repo is connected).
  if (sections.repo) {
    parts.push(
      `## Goals (NOT issues)\n\nA "goal" is a high-level objective surfaced as a GitHub **Discussion** and referenced as **#<number>** (e.g. "goal 1533", "#1533"). Goal numbers are a separate namespace from issue/PR numbers — \`github_get_issue\` will NOT find a goal and must never be used for one.\n\n- To answer anything about a goal (explain it, its status, its tasks), call \`get_goal\` with the number (or \`list_goals\` to discover it). Never assume a goal "doesn't exist" because an issue lookup failed.\n- A goal's tasks are issues carrying its \`taskLabel\` (\`goal:<id>\`, returned by \`get_goal\`/\`list_goals\`); pass that label to \`github_list_issues\` to enumerate them.\n- Use \`attach_task_to_goal\` / \`detach_task_from_goal\` to change which task issues belong to a goal.`,
    );
    if (sections.memoryIndex && sections.memoryIndex.trim().length > 0) {
      parts.push(
        `## Remembered context\n\nThe block below is the live index of \`.kody/memory/*.md\` for this repo.\nEach bullet is one stored memory: title, file id, one-line hook, and type.\nTreat it as the agent's persistent notes — facts/feedback/project context the\nuser has chosen to keep across sessions.\n\nRules:\n- Read this index before writing a new memory. If a similar entry already\n  exists, call \`update_memory\` instead of \`remember\` — duplicates are\n  noise.\n- Apply remembered \`feedback\` and \`user\` entries automatically (e.g. if a\n  feedback memory says "no console.log in this repo," don't add console.log\n  even if the current turn doesn't mention it).\n- Use \`recall(id)\` when the one-line hook isn't enough and you need the\n  full body before acting. When the index is truncated (or the hook you\n  need isn't there), use \`recall_search(query)\` to search every memory\n  file's body via GitHub code search.\n- Memory can be stale. If a remembered fact contradicts what you observe\n  in the code or the conversation, trust the current observation and update\n  or forget the memory rather than acting on it.\n\n${sections.memoryIndex.trim()}`,
      );
    }
  }

  // Executable glue — the kody-chat wrapper text + tools index.
  parts.push(
    `## Tools available\n\nThe block below is the live contents of the chat executable's \`tools\` allowlist. Use only the tools listed.\n\n${bundle.executable.tools.map((t) => `- \`${t}\``).join("\n")}`,
  );

  return parts.join("\n\n");
}

export type { DutyEntry, ExecutableEntry, SkillEntry };

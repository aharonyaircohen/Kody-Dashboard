/**
 * @fileType util
 * @domain kody
 * @pattern chat-defaults-files
 *
 * File I/O for optional app-local chat defaults overrides. Chat prompt source
 * can be represented with normal Kody primitive folders:
 * - `.kody/agent-actions/kody-chat/`
 * - `.kody/agent-responsibilities/kody-*` folders
 *
 * TypeScript defaults remain the fallback when those local override files are absent.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_IDENTITY_MD,
  DEFAULT_EXECUTABLE,
  DEFAULT_DUTIES,
  DEFAULT_SKILLS,
  type AgentResponsibilityEntry,
  type AgentActionEntry,
  type SkillEntry,
} from "./defaults";

export interface ChatDefaultsFilesBundle {
  agentIdentity: string;
  agentAction: AgentActionEntry;
  agentResponsibilities: AgentResponsibilityEntry[];
  skills: Record<string, SkillEntry>;
}

const KODY_CHAT_EXECUTABLE = ".kody/agent-actions/kody-chat";

function repoPath(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

async function readText(...segments: string[]): Promise<string> {
  return (await readFile(repoPath(...segments), "utf8")).trim();
}

async function readJson<T>(...segments: string[]): Promise<T> {
  return JSON.parse(await readText(...segments)) as T;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function assertAgentAction(value: AgentActionEntry): AgentActionEntry {
  if (
    !value ||
    typeof value.slug !== "string" ||
    typeof value.title !== "string" ||
    typeof value.describe !== "string" ||
    typeof value.prompt !== "string" ||
    !isStringArray(value.tools) ||
    !isStringArray(value.skills)
  ) {
    throw new Error("Invalid kody-chat agentAction profile");
  }

  return value;
}

async function loadAgentResponsibility(slug: string): Promise<AgentResponsibilityEntry> {
  const [profile, body] = await Promise.all([
    readJson<{ name?: unknown; describe?: unknown }>(
      ".kody",
      "agent-responsibilities",
      slug,
      "profile.json",
    ),
    readText(".kody", "agent-responsibilities", slug, "agent-responsibility.md"),
  ]);

  if (typeof profile.name !== "string" || typeof profile.describe !== "string") {
    throw new Error(`Invalid ${slug} agentResponsibility profile`);
  }

  return {
    slug: profile.name,
    title: profile.describe,
    body,
  };
}

async function loadSkill(slug: string): Promise<SkillEntry> {
  return {
    slug,
    title: slug,
    body: await readText(KODY_CHAT_EXECUTABLE, "skills", `${slug}.md`),
  };
}

export async function loadChatDefaultsFromFiles(): Promise<ChatDefaultsFilesBundle | null> {
  try {
    const [agentIdentity, agentAction] = await Promise.all([
      readText(KODY_CHAT_EXECUTABLE, "agent.md"),
      readJson<AgentActionEntry>(KODY_CHAT_EXECUTABLE, "profile.json").then(
        assertAgentAction,
      ),
    ]);

    const agentResponsibilities = await Promise.all(
      DEFAULT_DUTIES.map((agentResponsibility) => loadAgentResponsibility(agentResponsibility.slug)),
    );
    const skillEntries = await Promise.all(agentAction.skills.map(loadSkill));
    const skills = Object.fromEntries(
      skillEntries.map((skill) => [skill.slug, skill]),
    );

    return {
      agentIdentity,
      agentAction: {
        ...agentAction,
        prompt: await readText(KODY_CHAT_EXECUTABLE, "prompt.md"),
      },
      agentResponsibilities,
      skills,
    };
  } catch {
    return null;
  }
}

/**
 * Invalidate the per-repo cache for the chat defaults bundle. Local filesystem
 * reads are uncached; this hook stays for future remote repo-backed caching.
 */
export function invalidateChatDefaultsCache(
  _owner: string,
  _repo: string,
): void {
  // No-op: local filesystem reads are uncached.
}

export {
  DEFAULT_IDENTITY_MD,
  DEFAULT_EXECUTABLE,
  DEFAULT_DUTIES,
  DEFAULT_SKILLS,
};

export type { AgentResponsibilityEntry, AgentActionEntry, SkillEntry };

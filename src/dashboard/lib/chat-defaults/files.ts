/**
 * @fileType util
 * @domain kody
 * @pattern chat-defaults-files
 *
 * File I/O for optional app-local chat defaults overrides. Chat prompt source
 * can be represented with normal Kody primitive folders:
 * - `.kody/capabilities/kody-chat/`
 * - `.kody/capabilities/kody-*` workflow folders
 *
 * TypeScript defaults remain the fallback when those local override files are absent.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_IDENTITY_MD,
  DEFAULT_CHAT_CAPABILITY,
  DEFAULT_WORKFLOWS,
  DEFAULT_SKILLS,
  type ChatWorkflowEntry,
  type ChatCapabilityEntry,
  type SkillEntry,
} from "./defaults";

export interface ChatDefaultsFilesBundle {
  agentIdentity: string;
  capability: ChatCapabilityEntry;
  workflows: ChatWorkflowEntry[];
  skills: Record<string, SkillEntry>;
}

const KODY_CHAT_CAPABILITY = ".kody/capabilities/kody-chat";

function repoPath(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

async function readText(...segments: string[]): Promise<string> {
  return (await readFile(repoPath(...segments), "utf8")).trim();
}

async function readJson<T>(...segments: string[]): Promise<T> {
  return JSON.parse(await readText(...segments)) as T;
}

async function readOptionalText(...segments: string[]): Promise<string | null> {
  try {
    return await readText(...segments);
  } catch {
    return null;
  }
}

async function readOptionalJson<T>(...segments: string[]): Promise<T | null> {
  try {
    return await readJson<T>(...segments);
  } catch {
    return null;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function assertChatCapability(
  value: ChatCapabilityEntry,
  source = "capability",
): ChatCapabilityEntry {
  if (
    !value ||
    typeof value.slug !== "string" ||
    typeof value.title !== "string" ||
    typeof value.describe !== "string" ||
    typeof value.prompt !== "string" ||
    !isStringArray(value.tools) ||
    !isStringArray(value.skills)
  ) {
    throw new Error(`Invalid kody-chat ${source} profile`);
  }

  return value;
}

async function loadCapabilityWorkflow(
  slug: string,
): Promise<ChatWorkflowEntry | null> {
  const [profile, body] = await Promise.all([
    readOptionalJson<{
      slug?: unknown;
      name?: unknown;
      title?: unknown;
      describe?: unknown;
    }>(".kody", "capabilities", slug, "profile.json"),
    readOptionalText(".kody", "capabilities", slug, "capability.md"),
  ]);

  if (!profile || !body) return null;

  const resolvedSlug =
    typeof profile.slug === "string"
      ? profile.slug
      : typeof profile.name === "string"
        ? profile.name
        : slug;
  const title =
    typeof profile.title === "string"
      ? profile.title
      : typeof profile.describe === "string"
        ? profile.describe
        : resolvedSlug;

  return {
    slug: resolvedSlug,
    title,
    body,
  };
}

async function loadWorkflow(slug: string): Promise<ChatWorkflowEntry> {
  return (
    (await loadCapabilityWorkflow(slug)) ??
    DEFAULT_WORKFLOWS.find((workflow) => workflow.slug === slug)!
  );
}

async function loadSkill(slug: string, base: string): Promise<SkillEntry> {
  const body =
    (await readOptionalText(base, "skills", `${slug}.md`)) ??
    (await readOptionalText(base, "skills", slug, "SKILL.md")) ??
    DEFAULT_SKILLS[slug]?.body;

  if (!body) {
    throw new Error(`Missing ${slug} skill body`);
  }

  return {
    slug,
    title: DEFAULT_SKILLS[slug]?.title ?? slug,
    body,
  };
}

async function loadChatProfile(
  base: string,
  source: string,
): Promise<{
  base: string;
  agentIdentity: string;
  capability: ChatCapabilityEntry;
} | null> {
  const [agentIdentity, profile] = await Promise.all([
    readOptionalText(base, "agent.md"),
    readOptionalJson<ChatCapabilityEntry>(base, "profile.json"),
  ]);

  if (!agentIdentity || !profile) return null;

  const capability = assertChatCapability(profile, source);
  const prompt =
    (await readOptionalText(base, "prompt.md")) ??
    (await readOptionalText(base, "capability.md")) ??
    capability.prompt;

  return {
    base,
    agentIdentity,
    capability: {
      ...capability,
      prompt,
    },
  };
}

export async function loadChatDefaultsFromFiles(): Promise<ChatDefaultsFilesBundle | null> {
  try {
    const chatProfile = await loadChatProfile(KODY_CHAT_CAPABILITY, "capability");

    if (!chatProfile) return null;

    const workflows = await Promise.all(
      DEFAULT_WORKFLOWS.map((workflow) => loadWorkflow(workflow.slug)),
    );
    const skillEntries = await Promise.all(
      chatProfile.capability.skills.map((slug) =>
        loadSkill(slug, chatProfile.base),
      ),
    );
    const skills = Object.fromEntries(
      skillEntries.map((skill) => [skill.slug, skill]),
    );

    return {
      agentIdentity: chatProfile.agentIdentity,
      capability: chatProfile.capability,
      workflows,
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
  DEFAULT_CHAT_CAPABILITY,
  DEFAULT_WORKFLOWS,
  DEFAULT_SKILLS,
};

export type { ChatWorkflowEntry, ChatCapabilityEntry, SkillEntry };

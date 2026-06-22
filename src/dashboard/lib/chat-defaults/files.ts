/**
 * @fileType util
 * @domain kody
 * @pattern chat-defaults-files
 *
 * File I/O for the chat defaults bundle. Chat prompt source lives in normal
 * Kody primitives:
 * - `.kody/executables/kody-chat/`
 * - `.kody/duties/kody-*` folders
 *
 * TypeScript defaults remain the fallback when those repo files are absent.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_IDENTITY_MD,
  DEFAULT_EXECUTABLE,
  DEFAULT_DUTIES,
  DEFAULT_SKILLS,
  type DutyEntry,
  type ExecutableEntry,
  type SkillEntry,
} from "./defaults";

export interface ChatDefaultsFilesBundle {
  agentIdentity: string;
  executable: ExecutableEntry;
  duties: DutyEntry[];
  skills: Record<string, SkillEntry>;
}

const KODY_CHAT_EXECUTABLE = ".kody/executables/kody-chat";

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

function assertExecutable(value: ExecutableEntry): ExecutableEntry {
  if (
    !value ||
    typeof value.slug !== "string" ||
    typeof value.title !== "string" ||
    typeof value.describe !== "string" ||
    typeof value.prompt !== "string" ||
    !isStringArray(value.tools) ||
    !isStringArray(value.skills)
  ) {
    throw new Error("Invalid kody-chat executable profile");
  }

  return value;
}

async function loadDuty(slug: string): Promise<DutyEntry> {
  const [profile, body] = await Promise.all([
    readJson<{ name?: unknown; describe?: unknown }>(
      ".kody",
      "duties",
      slug,
      "profile.json",
    ),
    readText(".kody", "duties", slug, "duty.md"),
  ]);

  if (typeof profile.name !== "string" || typeof profile.describe !== "string") {
    throw new Error(`Invalid ${slug} duty profile`);
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
    const [agentIdentity, executable] = await Promise.all([
      readText(KODY_CHAT_EXECUTABLE, "agent.md"),
      readJson<ExecutableEntry>(KODY_CHAT_EXECUTABLE, "profile.json").then(
        assertExecutable,
      ),
    ]);

    const duties = await Promise.all(
      DEFAULT_DUTIES.map((duty) => loadDuty(duty.slug)),
    );
    const skillEntries = await Promise.all(executable.skills.map(loadSkill));
    const skills = Object.fromEntries(
      skillEntries.map((skill) => [skill.slug, skill]),
    );

    return {
      agentIdentity,
      executable: {
        ...executable,
        prompt: await readText(KODY_CHAT_EXECUTABLE, "prompt.md"),
      },
      duties,
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

export type { DutyEntry, ExecutableEntry, SkillEntry };

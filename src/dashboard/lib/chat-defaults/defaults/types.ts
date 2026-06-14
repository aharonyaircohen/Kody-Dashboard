/**
 * Shared types for the chat-defaults bundle.
 */

export interface ExecutableEntry {
  slug: string;
  title: string;
  describe: string;
  /** Flat list of tool names the chat exposes. Names match the registry. */
  tools: string[];
  /** Skill slugs the executable composes. */
  skills: string[];
  /** Glue text — how the executable wires persona + skills together. */
  prompt: string;
}

export interface DutyEntry {
  slug: string;
  title: string;
  body: string;
}

export interface SkillEntry {
  slug: string;
  title: string;
  body: string;
}

/**
 * Shared types for the chat-defaults bundle.
 */

export interface ChatCapabilityEntry {
  slug: string;
  title: string;
  describe: string;
  /** Flat list of tool names the chat exposes. Names match the registry. */
  tools: string[];
  /** Skill slugs the chat capability composes. */
  skills: string[];
  /** Glue text — how the capability wires agent identity, workflows, and skills together. */
  prompt: string;
}

export interface ChatWorkflowEntry {
  slug: string;
  title: string;
  body: string;
}

export interface SkillEntry {
  slug: string;
  title: string;
  body: string;
}

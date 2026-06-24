/**
 * Shared types for the chat-defaults bundle.
 */

export interface AgentActionEntry {
  slug: string;
  title: string;
  describe: string;
  /** Flat list of tool names the chat exposes. Names match the registry. */
  tools: string[];
  /** Skill slugs the agentAction composes. */
  skills: string[];
  /** Glue text — how the agentAction wires agentIdentity + skills together. */
  prompt: string;
}

export interface AgentResponsibilityEntry {
  slug: string;
  title: string;
  body: string;
}

export interface SkillEntry {
  slug: string;
  title: string;
  body: string;
}

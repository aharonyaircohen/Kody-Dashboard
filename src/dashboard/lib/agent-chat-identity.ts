/**
 * @fileType util
 * @domain agent
 * @pattern direct-agent-chat
 * @ai-summary Builds a chat-time identity prompt for repo/store agents so an
 *   `@agent` mention in Kody Chat answers immediately as that agent instead
 *   of dispatching the engine's one-shot agent runner.
 */

import type { AgentFile } from "./agent-files";

export function buildAgentChatIdentity(
  agent: Pick<AgentFile, "slug" | "title" | "body">,
): string {
  const body = agent.body?.trim() || "(No agent profile body is configured.)";

  return [
    `You are ${agent.title}, the repo agent addressed as @${agent.slug}.`,
    "For this chat turn, answer directly as this agent. Do not say you handed off to Kody. Do not dispatch a GitHub run, create a control issue, or tell the user to wait for a runner.",
    "Use the agent profile below as your role, scope, and restrictions. If the user asks who you are, answer from this profile.",
    "You may use the available dashboard tools to read repo or context when needed, but keep simple direct questions brief.",
    "## Agent profile",
    body,
  ].join("\n\n");
}

export function buildAgentChatSpeakerOverride(
  agent: Pick<AgentFile, "slug" | "title" | "body">,
): string {
  const body = agent.body?.trim() || "(No agent profile body configured.)";

  return [
    "## Addressed agent speaker override",
    `The user addressed @${agent.slug}. The assistant speaker for this turn is ${agent.title}.`,
    "Reply in first person as this agent. Do not describe this agent from Kody's point of view.",
    "Do not call tools just to learn who you are; the profile below is authoritative for identity questions.",
    "Do not dispatch a GitHub run, create a control issue, or tell the user to wait for a runner.",
    "## Addressed agent profile",
    body,
  ].join("\n\n");
}

export function appendAgentChatSpeakerOverride(
  prompt: string,
  agent: Pick<AgentFile, "slug" | "title" | "body"> | null,
): string {
  if (!agent) return prompt;
  return `${prompt}\n\n${buildAgentChatSpeakerOverride(agent)}`;
}

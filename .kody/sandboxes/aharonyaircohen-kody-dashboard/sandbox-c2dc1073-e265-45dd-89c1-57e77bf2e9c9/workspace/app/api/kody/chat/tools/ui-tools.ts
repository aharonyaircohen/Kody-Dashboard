/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Client-controllable UI actions. Each tool's execute returns a
 *  structured directive that KodyChat.tsx detects in the tool-output-available
 *  stream chunk and dispatches against React state. Server-side has no real
 *  side effect — the client owns the action.
 */
import { tool } from "ai";
import { z } from "zod";
import { AGENTS, type AgentId } from "@dashboard/lib/agents";
import {
  PREVIEW_ACT_DIRECTIVE,
  SWITCH_AGENT_DIRECTIVE,
  type PreviewActDirective,
  type SwitchAgentDirective,
  type SwitchAgentTargetId,
} from "@dashboard/lib/chat-ui-actions";

const SELECTABLE_AGENT_IDS = Object.values(AGENTS).map(
  (a) => a.id,
) as SwitchAgentTargetId[];

export const switchAgentTool = tool({
  description:
    "Switch the active dashboard agent in the chat UI. Call ONLY when the user " +
    'explicitly asks to change agents ("switch to Kody Live", "use Brain instead"). ' +
    'Do NOT call proactively to "find the right agent" for a question. The switch ' +
    "takes effect for the user's NEXT message, not the current turn — explain " +
    "that to the user. For Kody Live specifically, the first message after the " +
    "switch starts the live session (the runner boots on first message — there " +
    'is no separate "start" action). When the call is made from voice mode and ' +
    "the target agent's backend is not kody-direct, voice will close " +
    "automatically; mention that the user will need to type the next message.",
  inputSchema: z.object({
    agentId: z
      .enum(SELECTABLE_AGENT_IDS as [string, ...string[]])
      .describe(
        "Target agent id. Valid: " +
          SELECTABLE_AGENT_IDS.join(", ") +
          ". Voice is a modality (the mic icon), not an agent — every agent works in voice mode but only kody-direct agents keep the mic open after a switch.",
      ),
    reason: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "One short sentence explaining why you are switching. Shown back to the " +
          "user as confirmation. Keep it natural for TTS in voice mode.",
      ),
  }),
  execute: async ({
    agentId,
    reason,
  }): Promise<SwitchAgentDirective | { error: string }> => {
    const target = AGENTS[agentId as AgentId];
    if (!target) {
      return { error: `Unknown agent id "${agentId}"` };
    }
    return {
      action: SWITCH_AGENT_DIRECTIVE,
      agentId: agentId as SwitchAgentTargetId,
      agentName: target.name,
      reason,
    };
  },
});

export const previewActTool = tool({
  description:
    "Drive the preview iframe: click, fill, navigate, scroll, or wait. " +
    "Use ONLY when the user asks you to interact with or verify something in " +
    'the preview (e.g. "log in", "click the Save button", "scroll to the footer"). ' +
    "The action runs in the user's browser via the Kody Preview Inspector " +
    "extension; if the extension isn't installed the call surfaces an error and you " +
    "should tell the user. Each successful call returns a fresh DOM snapshot " +
    "as a follow-up user turn so you can chain steps (e.g. fill email → fill " +
    "password → click submit → read the next page).",
  inputSchema: z.object({
    op: z
      .enum(["click", "fill", "navigate", "scroll", "wait"])
      .describe("Which kind of action to run."),
    selector: z
      .string()
      .optional()
      .describe(
        "CSS selector identifying the target element. Required for click/fill. " +
          "Optional for scroll (when scrolling to an element rather than by dy).",
      ),
    value: z
      .string()
      .optional()
      .describe("Value to set on a fill op. Ignored for other ops."),
    url: z
      .string()
      .optional()
      .describe(
        "Same-origin URL to navigate to. Cross-origin navigation is blocked.",
      ),
    dy: z
      .number()
      .int()
      .optional()
      .describe("Pixels to scroll by (used when selector is not provided)."),
    ms: z
      .number()
      .int()
      .min(0)
      .max(5000)
      .optional()
      .describe("Milliseconds to wait. Used by op=wait. Max 5000."),
    reason: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "One short sentence explaining why you're running this action. " +
          "Shown to the user as confirmation.",
      ),
  }),
  execute: async (input): Promise<PreviewActDirective> => {
    return {
      action: PREVIEW_ACT_DIRECTIVE,
      op: input.op,
      selector: input.selector,
      value: input.value,
      url: input.url,
      dy: input.dy,
      ms: input.ms,
      reason: input.reason,
    };
  },
});

export const uiTools = {
  switch_agent: switchAgentTool,
  preview_act: previewActTool,
};

/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Client-controllable UI actions. Each tool's execute returns a
 *  structured directive that KodyChat.tsx detects in the tool-output-available
 *  stream chunk and dispatches against React state. Server-side has no real
 *  side effect — the client owns the action.
 */
import { tool } from 'ai'
import { z } from 'zod'
import { AGENTS, type AgentId } from '@dashboard/lib/agents'
import {
  SWITCH_AGENT_DIRECTIVE,
  type SwitchAgentDirective,
  type SwitchAgentTargetId,
} from '@dashboard/lib/chat-ui-actions'

const SELECTABLE_AGENT_IDS = Object.values(AGENTS)
  .filter((a) => a.id !== 'kody-speech')
  .map((a) => a.id) as SwitchAgentTargetId[]

export const switchAgentTool = tool({
  description:
    'Switch the active dashboard agent in the chat UI. Call ONLY when the user ' +
    'explicitly asks to change agents ("switch to Kody Live", "use Brain instead", ' +
    '"talk to Gemini"). Do NOT call proactively to "find the right agent" for a ' +
    'question. The switch takes effect for the user\'s NEXT message, not the ' +
    'current turn — explain that to the user. For Kody Live specifically, the ' +
    'first message after the switch starts the live session (the runner boots ' +
    'on first message — there is no separate "start" action). When the call is ' +
    'made from voice mode and the target agent is not voice-tuned (anything ' +
    'except kody / kody-assistant), voice will close automatically; mention ' +
    'that the user will need to type the next message.',
  inputSchema: z.object({
    agentId: z
      .enum(SELECTABLE_AGENT_IDS as [string, ...string[]])
      .describe(
        'Target agent id. Valid: ' +
          SELECTABLE_AGENT_IDS.join(', ') +
          '. "kody-speech" is not selectable — voice is a modality, not an agent.',
      ),
    reason: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'One short sentence explaining why you are switching. Shown back to the ' +
          'user as confirmation. Keep it natural for TTS in voice mode.',
      ),
  }),
  execute: async ({ agentId, reason }): Promise<SwitchAgentDirective | { error: string }> => {
    const target = AGENTS[agentId as AgentId]
    if (!target || agentId === 'kody-speech') {
      return { error: `Unknown or non-selectable agent id "${agentId}"` }
    }
    return {
      action: SWITCH_AGENT_DIRECTIVE,
      agentId: agentId as SwitchAgentTargetId,
      agentName: target.name,
      reason,
    }
  },
})

export const uiTools = {
  switch_agent: switchAgentTool,
}

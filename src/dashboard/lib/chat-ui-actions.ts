/**
 * @fileType types
 * @domain kody
 * @pattern shared-contract
 * @ai-summary Shared contract between the in-process chat route's UI tools
 *  (server) and KodyChat.tsx's stream parser (client). The route's
 *  `switch_agent` tool returns a `SwitchAgentDirective`; the client detects
 *  it via `isSwitchAgentDirective` in the tool-output-available stream chunk.
 */
import type { AgentId } from './agents'

export const SWITCH_AGENT_DIRECTIVE = 'switch_agent' as const

export type SwitchAgentTargetId = Exclude<AgentId, 'kody-speech'>

export interface SwitchAgentDirective {
  action: typeof SWITCH_AGENT_DIRECTIVE
  agentId: SwitchAgentTargetId
  agentName: string
  reason: string
  /**
   * Optional kickoff message. When set, the client auto-sends this string
   * as the first user message under the new agent after the switch. Used
   * by `vibe_start_execution` to immediately ask the runner to implement
   * the issue — without it the runner just idles after the agent flip,
   * waiting for the user to type something, and the draft PR stays empty.
   */
  autoKickoff?: string
}

export function isSwitchAgentDirective(value: unknown): value is SwitchAgentDirective {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.action === SWITCH_AGENT_DIRECTIVE &&
    typeof v.agentId === 'string' &&
    v.agentId !== 'kody-speech' &&
    typeof v.agentName === 'string' &&
    typeof v.reason === 'string' &&
    (v.autoKickoff === undefined || typeof v.autoKickoff === 'string')
  )
}

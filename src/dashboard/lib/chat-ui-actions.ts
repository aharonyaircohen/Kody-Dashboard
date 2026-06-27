/**
 * @fileType types
 * @domain kody
 * @pattern shared-contract
 * @ai-summary Shared contract between the in-process chat route's UI tools
 *  (server) and KodyChat.tsx's stream parser (client). The route's
 *  `switch_agent` tool returns a `SwitchAgentDirective`; the client detects
 *  it via `isSwitchAgentDirective` in the tool-output-available stream chunk.
 */
import type { AgentId } from "./agents";

export const SWITCH_AGENT_DIRECTIVE = "switch_agent" as const;
export const PREVIEW_ACT_DIRECTIVE = "preview_act" as const;

/**
 * Voice is a modality, not an agent — every agent in the registry is a
 * legitimate switch target. Alias kept so the codebase can document intent
 * (and so callers don't have to import AgentId just to type a directive).
 */
export type SwitchAgentTargetId = AgentId;

export interface SwitchAgentDirective {
  action: typeof SWITCH_AGENT_DIRECTIVE;
  agentId: SwitchAgentTargetId;
  agentName: string;
  reason: string;
  /**
   * Optional kickoff message. When set, the client auto-sends this string
   * as the first user message under the new agent after the switch. This is
   * kept as a generic switch-agent affordance; Vibe execution uses the
   * dedicated `/api/kody/vibe/execute` workflow instead.
   */
  autoKickoff?: string;
  /**
   * Issue number the kickoff targets. The client gates the auto-kickoff
   * useEffect on `context.task.issueNumber === autoKickoffIssueNumber`
   * — without that gate, the kickoff fires the moment context flips to
   * ANY task scope (typically the previously-viewed issue, because the
   * tasks list hasn't refetched the NEW one yet), and the runner gets
   * dispatched against the wrong sessionId.
   */
  autoKickoffIssueNumber?: number;
}

/**
 * A chat-driven action against the preview frame. The server tool just emits
 * this directive; the client (KodyChat) hands it to the Kody Preview
 * Inspector extension via `useElementPicker.act()` and replies with a
 * synthetic user message carrying the result so the model can chain steps.
 */
export interface PreviewActDirective {
  action: typeof PREVIEW_ACT_DIRECTIVE;
  /** Single-character op + selector + value, mirroring PreviewAction. */
  op: "click" | "fill" | "navigate" | "scroll" | "wait";
  selector?: string;
  value?: string;
  url?: string;
  dy?: number;
  ms?: number;
  /** Short rationale shown to the user (e.g. "logging you in to verify"). */
  reason: string;
}

export function isPreviewActDirective(
  value: unknown,
): value is PreviewActDirective {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.action !== PREVIEW_ACT_DIRECTIVE) return false;
  const okOp =
    v.op === "click" ||
    v.op === "fill" ||
    v.op === "navigate" ||
    v.op === "scroll" ||
    v.op === "wait";
  return okOp && typeof v.reason === "string";
}

export function isSwitchAgentDirective(
  value: unknown,
): value is SwitchAgentDirective {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.action === SWITCH_AGENT_DIRECTIVE &&
    typeof v.agentId === "string" &&
    typeof v.agentName === "string" &&
    typeof v.reason === "string" &&
    (v.autoKickoff === undefined || typeof v.autoKickoff === "string") &&
    (v.autoKickoffIssueNumber === undefined ||
      (typeof v.autoKickoffIssueNumber === "number" &&
        Number.isInteger(v.autoKickoffIssueNumber) &&
        v.autoKickoffIssueNumber > 0))
  );
}

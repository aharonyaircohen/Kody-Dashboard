/**
 * @fileType module
 * @domain chat-platform
 * @pattern chat-transport-adapter
 * @ai-summary Kody-live / engine ChatTransport adapter (plan H1, Step 2c).
 *   Lifecycle model: reducer-driven runner lifecycle — deliberately THIN.
 *   The runner's session start (/interactive/start), rehydration, SSE
 *   event stream, and phase reducer stay with the surface + the
 *   kody-chat-reducer; this adapter wraps only the dispatch mechanics:
 *   queueing a turn onto a running session (`append`) or dispatching the
 *   GH Actions chat workflow (`trigger`). Both are fire-and-ack — the
 *   assistant reply arrives later through the runner's event stream, so
 *   the adapter emits only a `waiting-runner` status on acceptance and
 *   throws the route's error message on rejection.
 */

import type { ChatTransport, ChatTransportContext } from "./transport-types";

export const KODY_LIVE_APPEND_ENDPOINT = "/api/kody/chat/interactive/append";
export const KODY_LIVE_TRIGGER_ENDPOINT = "/api/kody/chat/trigger";

export interface KodyLiveTurnConfig {
  /**
   * `append` = queue onto a live interactive session (auth headers must
   * be the session-scoped live auth). `trigger` = dispatch the engine
   * chat workflow via GH Actions (regular dashboard auth).
   */
  kind: "append" | "trigger";
  /** The full request body — assembled by the surface (it owns state). */
  body: Readonly<Record<string, unknown>>;
}

function isKodyLiveTurnConfig(value: unknown): value is KodyLiveTurnConfig {
  if (!value || typeof value !== "object") return false;
  const cfg = value as Partial<KodyLiveTurnConfig>;
  return (
    (cfg.kind === "append" || cfg.kind === "trigger") &&
    !!cfg.body &&
    typeof cfg.body === "object"
  );
}

/**
 * Queue one turn for the runner. Resolves on acceptance; throws the
 * route-provided error message on rejection. NOTE the deliberate
 * asymmetry, preserved from the pre-adapter code: `append` tolerates a
 * non-JSON error body (`.catch({})` → falls back to `HTTP <status>`),
 * while `trigger` lets a malformed error body throw its own parse error.
 */
export async function sendKodyLiveTurn(
  config: KodyLiveTurnConfig,
  ctx: ChatTransportContext,
): Promise<void> {
  if (config.kind === "append") {
    const appendRes = await fetch(KODY_LIVE_APPEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...ctx.authHeaders,
      },
      body: JSON.stringify(config.body),
    });
    if (!appendRes.ok) {
      const body = (await appendRes.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(body.error ?? `HTTP ${appendRes.status}`);
    }
    ctx.emit({ type: "status", status: "waiting-runner" });
    return;
  }

  const triggerRes = await fetch(KODY_LIVE_TRIGGER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ctx.authHeaders },
    body: JSON.stringify(config.body),
  });
  if (!triggerRes.ok) {
    const errorData = (await triggerRes.json()) as { error?: string };
    throw new Error(errorData.error || `HTTP ${triggerRes.status}`);
  }
  ctx.emit({ type: "status", status: "waiting-runner" });
}

/**
 * ChatTransport wrapper. The turn config rides in `input.context`
 * (callers build it with `satisfies KodyLiveTurnConfig`).
 */
export const kodyLiveTransport: ChatTransport = {
  id: "kody-live",
  async send(input, ctx) {
    if (!isKodyLiveTurnConfig(input.context)) {
      throw new Error(
        "kodyLiveTransport.send requires a KodyLiveTurnConfig in input.context",
      );
    }
    await sendKodyLiveTurn(input.context, ctx);
  },
};

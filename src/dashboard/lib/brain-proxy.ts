/**
 * @fileType library
 * @domain brain
 * @pattern brain-proxy
 *
 * Shared "Brain SSE proxy" used by both Brain chat endpoints:
 *   - /api/kody/chat/brain      — external Brain server (URL/key from Settings).
 *   - /api/kody/chat/brain-fly  — per-user Brain on Fly (URL/key from server-side
 *     provisionBrain()).
 *
 * Both endpoints share the same wire protocol with the upstream Brain server
 * — `POST {brainUrl}/chats/{chatId}/messages` with `X-Api-Key`, SSE response —
 * so the body decoration (task/agentResponsibility preambles, attachment merging) and the
 * SSE translation into the dashboard's `chat.message | chat.tool_use |
 * chat.done | chat.error` shape live here in one place.
 *
 * Routes are responsible only for:
 *   1. Auth + body validation.
 *   2. Resolving brainUrl + brainKey (from headers vs from provisionBrain).
 *   3. Calling streamBrainChat() and returning the Response.
 */

import { logger } from "@dashboard/lib/logger";
import { fetchIssueAttachments } from "@dashboard/lib/issue-attachments";

export interface BrainTaskContext {
  issueNumber?: number;
  title?: string;
  body?: string;
  state?: string;
  labels?: string[];
  column?: string;
  pipeline?: { state?: string; currentStage?: string | null };
  associatedPR?: { number?: number; state?: string; html_url?: string };
}

export interface BrainAttachment {
  name?: string;
  mimeType?: string;
  /** Data URL (`data:image/png;base64,...`) or raw base64. */
  data?: string;
}

export interface BrainAgentResponsibilityContext {
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  labels?: string[];
}

export interface BrainChatRequest {
  brainUrl: string;
  brainKey: string;
  chatId: string;
  message: string;
  taskContext?: BrainTaskContext;
  attachments?: BrainAttachment[];
  agentResponsibilityContext?: BrainAgentResponsibilityContext;
  /** owner/name of the user's repo (forwarded so Brain can clone a worktree). */
  repo?: string;
  /**
   * GitHub token (the user's PAT) so Brain can clone a private `repo` into a
   * worktree. Without it a dev Brain server has no credentials of its own and
   * the clone fails. Trust level matches the user-configured Brain URL/key.
   */
  repoToken?: string;
  /**
   * Voice modality. When true the upstream Brain server should append the
   * shared voice overlay (see `@dashboard/lib/voice/overlay`) to its system
   * prompt for this turn — short sentences, no markdown, symbols-as-words.
   * The dashboard streams the resulting text into TTS as-is.
   *
   * Brain-side contract: if the server doesn't recognize the field, it
   * SHOULD treat the turn as text (current behavior). The dashboard gates
   * the mic on `agent.supportsVoice`, so an old server still receiving
   * voice payloads is a deploy-skew issue, not a correctness issue.
   */
  voiceMode?: boolean;
  /**
   * Reconnect cursor. When set, the proxy does NOT start a new turn — it
   * attaches to the (possibly still-running) turn for `chatId` via Brain's
   * `GET /chats/:id/stream?since=<resumeSince>`, replaying events the client
   * missed then live-tailing to the terminal event. This is what lets a Brain
   * reply outlive the ~300s Vercel function ceiling: the browser reconnects
   * with its last-seen `seq` instead of losing the turn. `message` is ignored
   * when this is set.
   */
  resumeSince?: number;
  /**
   * The assistant text the client has already rendered for this turn. Brain
   * replays only events with `seq > resumeSince`, so without this the proxy's
   * cumulative `chat.message` would emit only the tail and the client would
   * truncate the visible reply. Seeding the buffer with it keeps the
   * cumulative-replace contract intact across a reconnect.
   */
  resumeText?: string;
  /**
   * User-picked thinking level for the upstream Brain model (e.g. "low",
   * "medium", "high"). Forwarded verbatim — Brain server ≥ the version
   * that knows this field translates it to its provider's wire shape.
   * Older servers ignore it. Brain chat rows don't surface a `reasoning`
   * block in the picker (Brain owns its own reasoning config) so this
   * only flows when the user is on a gateway model that the Brain proxy
   * is *not* serving — kept here for forward compatibility.
   */
  reasoningEffort?: string;
  /**
   * When true, append the plain-language style preamble so Brain answers in
   * simpler terms (short sentences, no jargon, lead with the answer). Set by
   * the brain-fly route only; the external `/brain` endpoint leaves Brain's
   * own answer style untouched.
   */
  plainLanguage?: boolean;
}

/**
 * Output-only style overlay: makes Brain answer in plain, simple terms.
 * Appended LAST in the decorated message so its formatting rules win by
 * recency over the repo/task/agentResponsibility preambles (same reasoning as the voice
 * overlay). It reshapes OUTPUT only — no mention of tools or agentIdentity.
 */
export const PLAIN_LANGUAGE_PREAMBLE = `[Answer style]
Answer in plain, simple terms — explain it like you would to a smart teammate who is new to this codebase.
- Lead with the direct answer or recommendation in the first sentence. No preamble.
- Short sentences, one idea each. Prefer two short sentences over one long one.
- Avoid jargon and acronyms; if a technical term is unavoidable, say what it means in a few words.
- Describe the effect before the mechanism. Only go into implementation detail if the user asks.
- Keep it tight. Offer to go deeper instead of dumping everything up front.`;

/** Wire shape of events received from the upstream Brain server. */
interface BrainEvent {
  type: "chat" | "text" | "tool_use" | "done" | "error";
  chatId?: string;
  text?: string;
  name?: string;
  input?: unknown;
  error?: string;
  /** Per-chat monotonic cursor (absent on the `chat` handshake). */
  seq?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Preamble builders — small, pure, exported for tests.
// ────────────────────────────────────────────────────────────────────────────

export function formatTaskContext(
  tc: BrainTaskContext | undefined,
): string | null {
  if (!tc || !tc.issueNumber) return null;
  const parts: string[] = [];
  parts.push(`[Current task context]`);
  parts.push(`- Issue: #${tc.issueNumber}${tc.title ? ` — ${tc.title}` : ""}`);
  if (tc.state) parts.push(`- State: ${tc.state}`);
  if (tc.column) parts.push(`- Column: ${tc.column}`);
  if (tc.labels?.length) parts.push(`- Labels: ${tc.labels.join(", ")}`);
  if (tc.pipeline?.state) {
    const stage = tc.pipeline.currentStage
      ? ` (stage: ${tc.pipeline.currentStage})`
      : "";
    parts.push(`- Pipeline: ${tc.pipeline.state}${stage}`);
  }
  if (tc.associatedPR?.number) {
    parts.push(
      `- PR: #${tc.associatedPR.number}${tc.associatedPR.state ? ` (${tc.associatedPR.state})` : ""}${
        tc.associatedPR.html_url ? ` — ${tc.associatedPR.html_url}` : ""
      }`,
    );
  }
  if (tc.body) {
    const truncated =
      tc.body.length > 1500 ? `${tc.body.slice(0, 1500)}…` : tc.body;
    parts.push(`\n[Description]\n${truncated}`);
  }
  parts.push(
    "\nThe user is chatting about this task. Before acting, ask whether they want you to resolve it directly using your tools or to open/refine a GitHub issue for it — do NOT pick on your own. Once they choose, proceed that way without asking again for this task.",
  );
  return parts.join("\n");
}

export function formatAgentResponsibilityContext(
  mc: BrainAgentResponsibilityContext | undefined,
): string | null {
  if (!mc || mc.number == null) return null;
  const parts: string[] = [];
  parts.push(`[Current agentResponsibility]`);
  parts.push(
    `- AgentResponsibility: #${mc.number}${mc.title ? ` — ${mc.title}` : ""}`,
  );
  if (mc.state) parts.push(`- State: ${mc.state}`);
  if (mc.labels?.length) parts.push(`- Labels: ${mc.labels.join(", ")}`);
  if (mc.body) {
    const truncated =
      mc.body.length > 1500 ? `${mc.body.slice(0, 1500)}…` : mc.body;
    parts.push(`\n[AgentResponsibility body]\n${truncated}`);
  }
  parts.push(
    "\nThe user is chatting about this specific agentResponsibility. A Kody agentResponsibility is a folder at state-repo `agent-responsibilities/<slug>/`: `profile.json` holds action/cadence/agents metadata, and `agent-responsibility.md` describes purpose, output, allowed commands, and restrictions. Answer grounded in the body above — do NOT claim the agentResponsibility does not exist.",
  );
  return parts.join("\n");
}

export function buildDecoratedMessage(
  message: string,
  opts: {
    taskContext?: BrainTaskContext;
    agentResponsibilityContext?: BrainAgentResponsibilityContext;
    repo?: string;
    plainLanguage?: boolean;
  },
): string {
  // The `repo` JSON field is at most a one-time clone hint Brain consumes to
  // set up a worktree — it never reaches the model's context. State it in the
  // message every turn so the model knows which repo to reason about (and so a
  // dev Brain with no worktree still answers grounded in the right repo).
  const repoPreamble = opts.repo
    ? `[Repository]\nThe user has ${opts.repo} selected in the dashboard. All questions are about this repository unless they say otherwise — inspect its code/issues/PRs for context and refer to it by name.\n\nBefore making any code change or fix, first explain what you intend to change and why, then STOP and wait for the user to explicitly approve. Do NOT edit, commit, or push in the same turn as the explanation — the approval ask must be the last thing you do that turn. Only after the user says go: make the change, commit with a clear conventional-commit message, and push to the working branch as the final step — don't leave approved changes uncommitted.`
    : null;
  const taskPreamble = formatTaskContext(opts.taskContext);
  const agentResponsibilityPreamble = formatAgentResponsibilityContext(
    opts.agentResponsibilityContext,
  );
  // Style overlay goes LAST so its output rules win by recency over the
  // repo/task/agentResponsibility context blocks above it.
  const stylePreamble = opts.plainLanguage ? PLAIN_LANGUAGE_PREAMBLE : null;
  const preamble =
    [repoPreamble, agentResponsibilityPreamble, taskPreamble, stylePreamble]
      .filter(Boolean)
      .join("\n\n") || null;
  return preamble ? `${preamble}\n\n[User]\n${message}` : message;
}

// ────────────────────────────────────────────────────────────────────────────
// streamBrainChat — the proxy core.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Forward a chat turn to an upstream Brain server and stream the SSE response
 * back to the client, translated into the dashboard's chat event shape.
 *
 * Returns a `Response` ready to be returned from a Next.js route handler.
 * On unrecoverable upstream errors (network, non-2xx), returns a JSON error
 * Response with status 502 instead.
 */
export async function streamBrainChat(
  input: BrainChatRequest,
): Promise<Response> {
  const decoratedMessage = buildDecoratedMessage(input.message, {
    taskContext: input.taskContext,
    agentResponsibilityContext: input.agentResponsibilityContext,
    repo: input.repo,
    plainLanguage: input.plainLanguage,
  });

  const clientAttachments = Array.isArray(input.attachments)
    ? input.attachments
    : [];

  // When chatting about an issue, pull every attachment referenced in the
  // issue body + comments and hand them to Brain alongside chat attachments.
  // Re-fetched per request because per-session caching isn't worth the
  // complexity yet.
  let issueAttachments: Awaited<ReturnType<typeof fetchIssueAttachments>> = [];
  if (input.taskContext?.issueNumber) {
    try {
      issueAttachments = await fetchIssueAttachments(
        input.taskContext.issueNumber,
      );
    } catch (err) {
      logger.warn(
        { err, issueNumber: input.taskContext.issueNumber },
        "brain-proxy: failed to resolve issue attachments (continuing without them)",
      );
    }
  }

  const attachments = [...clientAttachments, ...issueAttachments];

  const requestId = crypto.randomUUID();
  const base = input.brainUrl.replace(/\/+$/, "");
  const chatPath = encodeURIComponent(input.chatId);
  const isResume = Number.isFinite(input.resumeSince);
  // Resume → attach to the in-flight/finished turn and replay past `since`.
  // Fresh → start a new turn.
  const target = isResume
    ? `${base}/chats/${chatPath}/stream?since=${Number(input.resumeSince)}`
    : `${base}/chats/${chatPath}/messages`;

  // Bound the *connect* (time-to-headers) wait so a Brain server that hangs
  // before it ever responds surfaces an error instead of the UI spinning on
  // "thinking" forever. The streaming read has its own separate idle timeout
  // below — we don't abort a slow-but-alive stream, only a dead connection.
  const CONNECT_TIMEOUT_MS = 60_000;
  const connectController = new AbortController();
  const connectTimer = setTimeout(
    () => connectController.abort(),
    CONNECT_TIMEOUT_MS,
  );

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: isResume ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": input.brainKey,
      },
      ...(isResume
        ? {}
        : {
            body: JSON.stringify({
              message: decoratedMessage,
              ...(attachments.length > 0 ? { attachments } : {}),
              ...(input.repo ? { repo: input.repo } : {}),
              ...(input.repoToken ? { repoToken: input.repoToken } : {}),
              ...(input.voiceMode === true ? { voiceMode: true } : {}),
              ...(input.reasoningEffort
                ? { reasoningEffort: input.reasoningEffort }
                : {}),
            }),
          }),
      signal: connectController.signal,
    });
  } catch (err) {
    clearTimeout(connectTimer);
    const timedOut = connectController.signal.aborted;
    if (timedOut) {
      logger.error(
        { requestId, chatId: input.chatId },
        "brain-proxy: connect timeout (no response headers)",
      );
      return new Response(
        JSON.stringify({
          error: `Brain chat server did not respond within ${CONNECT_TIMEOUT_MS / 1000}s`,
        }),
        { status: 504, headers: { "content-type": "application/json" } },
      );
    }
    logger.error(
      { err, requestId, chatId: input.chatId },
      "brain-proxy: fetch failed",
    );
    return new Response(
      JSON.stringify({ error: "Brain chat server unreachable" }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  // Headers arrived — connect succeeded. Stop the connect timer so it can't
  // fire mid-stream (the stream has its own idle timeout below).
  clearTimeout(connectTimer);

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    logger.error(
      { requestId, chatId: input.chatId, status: upstream.status, text },
      "brain-proxy: upstream error",
    );
    const detail = text.trim().slice(0, 500);
    return new Response(
      JSON.stringify({
        error: detail
          ? `Brain upstream returned ${upstream.status}: ${detail}`
          : `Brain upstream returned ${upstream.status}`,
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  logger.info(
    { requestId, chatId: input.chatId },
    "brain-proxy: streaming response",
  );

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  // On resume, seed the cumulative buffer with what the client already shows
  // so post-`since` deltas append instead of replacing the visible reply.
  let assistantBuffer = isResume ? (input.resumeText ?? "") : "";
  // Highest Brain seq forwarded — the client echoes this back as `resumeSince`
  // to reconnect. Starts at the resume cursor so a reconnect that yields no
  // new events still reports a correct (non-regressing) cursor.
  let lastSeq = isResume ? Number(input.resumeSince) : 0;
  let sawTerminal = false;
  let budgetHit = false;

  const translated = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ ...event, seq: lastSeq })}\n\n`,
          ),
        );
      };

      // Proactively hand the turn back to the client before Vercel hard-kills
      // the function at its 300s ceiling. We close ~30s early with a
      // `chat.reconnect` sentinel carrying the cursor, so the browser
      // reconnects cleanly instead of eating a mid-line TCP reset. The turn
      // itself keeps running server-side on Brain.
      const BUDGET_MS = 270_000;
      const budgetTimer = setTimeout(() => {
        budgetHit = true;
        emit({ type: "chat.reconnect" });
        closed = true;
        reader.cancel().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }, BUDGET_MS);

      const reader = upstream.body!.getReader();
      let buf = "";

      const parseBrainChunk = (text: string) => {
        const lines = text.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let ev: BrainEvent;
          try {
            ev = JSON.parse(raw) as BrainEvent;
          } catch {
            continue;
          }

          // Advance the cursor before emitting so the dashboard event carries
          // the seq of the Brain event that produced it.
          if (typeof ev.seq === "number" && ev.seq > lastSeq) {
            lastSeq = ev.seq;
          }
          if (ev.type === "done" || ev.type === "error") {
            sawTerminal = true;
          }

          switch (ev.type) {
            case "chat":
              // Handshake. Confirms the chatId. Nothing to render.
              break;

            case "text":
              if (typeof ev.text === "string" && ev.text.length > 0) {
                inFlightTool = false;
                assistantBuffer += ev.text;
                emit({
                  type: "chat.message",
                  role: "assistant",
                  content: assistantBuffer,
                  timestamp: new Date().toISOString(),
                });
              }
              break;

            case "tool_use":
              // Structured tool event so the client can render a consolidated
              // "thinking" panel rather than polluting prose with inline tool
              // markers. Brain doesn't stream tool results separately — the
              // narrated output arrives in the next `text` chunk. Mark the
              // stream as alive so the idle-timeout window widens to
              // IDLE_TIMEOUT_DURING_TOOL_MS for the duration of the call.
              inFlightTool = true;
              emit({
                type: "chat.tool_use",
                id: crypto.randomUUID(),
                name: ev.name ?? "tool",
                input: ev.input ?? {},
                timestamp: new Date().toISOString(),
              });
              break;

            case "done":
              inFlightTool = false;
              emit({ type: "chat.done" });
              break;

            case "error":
              inFlightTool = false;
              emit({ type: "chat.error", error: ev.error ?? "Brain error" });
              break;
          }
        }
      };

      // Idle timeout: a connected-but-silent stream is the actual "stuck on
      // thinking" symptom. If no chunk arrives for this long, give up and
      // surface an error instead of holding the spinner open indefinitely.
      // Reset every time a chunk lands, so a long healthy response is fine —
      // only true silence trips it.
      //
      // Brain is allowed to be silent for longer while a tool call is in
      // flight — `tool_use` is proof of life even though no text/done chunk
      // arrives until the tool returns (which can be many minutes for a big
      // build, test run, or git operation). We bump the idle budget for the
      // duration of an in-flight tool and revert to the default once text or a
      // terminal event resumes the stream.
      const IDLE_TIMEOUT_DEFAULT_MS = 120_000;
      const IDLE_TIMEOUT_DURING_TOOL_MS = 600_000;
      let inFlightTool = false;
      const readWithIdleTimeout = () => {
        const idleMs = inFlightTool
          ? IDLE_TIMEOUT_DURING_TOOL_MS
          : IDLE_TIMEOUT_DEFAULT_MS;
        return Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("brain-idle-timeout")), idleMs),
          ),
        ]);
      };

      try {
        while (true) {
          const { done, value } = await readWithIdleTimeout();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lastNewline = buf.lastIndexOf("\n");
          if (lastNewline !== -1) {
            parseBrainChunk(buf.slice(0, lastNewline + 1));
            buf = buf.slice(lastNewline + 1);
          }
        }
        if (buf.trim()) parseBrainChunk(buf);
        // Upstream closed without a terminal event and we didn't close it for
        // the budget — the Brain connection dropped but the turn may still be
        // running server-side. Tell the client to reconnect from the cursor
        // rather than falsely ending the reply.
        if (!sawTerminal && !budgetHit && !closed) {
          emit({ type: "chat.reconnect" });
        }
      } catch (err) {
        if (budgetHit) {
          // Expected: we cancelled the reader to hand off before the Vercel
          // ceiling. The reconnect sentinel was already emitted.
        } else {
          const idle =
            err instanceof Error && err.message === "brain-idle-timeout";
          logger.error(
            { err, requestId, chatId: input.chatId, idle },
            idle
              ? "brain-proxy: stream idle timeout (no chunk for 120s)"
              : "brain-proxy: stream read error",
          );
          // The turn keeps running on Brain; a reconnect replays from the
          // cursor. The client bounds retries and surfaces a real error if
          // reconnection keeps failing.
          emit({ type: "chat.reconnect" });
          await reader.cancel().catch(() => {});
        }
      } finally {
        clearTimeout(budgetTimer);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
  });

  return new Response(translated, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

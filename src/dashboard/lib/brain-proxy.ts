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
 * so the body decoration (task/job preambles, attachment merging) and the
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

export interface BrainJobContext {
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
  jobDraft?: boolean;
  jobContext?: BrainJobContext;
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
}

/** Wire shape of events received from the upstream Brain server. */
interface BrainEvent {
  type: "chat" | "text" | "tool_use" | "done" | "error";
  chatId?: string;
  text?: string;
  name?: string;
  input?: unknown;
  error?: string;
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

export function formatJobContext(
  mc: BrainJobContext | undefined,
): string | null {
  if (!mc || mc.number == null) return null;
  const parts: string[] = [];
  parts.push(`[Current job]`);
  parts.push(`- Job: #${mc.number}${mc.title ? ` — ${mc.title}` : ""}`);
  if (mc.state) parts.push(`- State: ${mc.state}`);
  if (mc.labels?.length) parts.push(`- Labels: ${mc.labels.join(", ")}`);
  if (mc.body) {
    const truncated =
      mc.body.length > 1500 ? `${mc.body.slice(0, 1500)}…` : mc.body;
    parts.push(`\n[Job body]\n${truncated}`);
  }
  parts.push(
    "\nThe user is chatting about this specific job. A Kody job is a GitHub issue (label kody:job) whose body describes intent, system prompt, allowed commands, and restrictions. Answer grounded in the body above — do NOT claim the job does not exist.",
  );
  return parts.join("\n");
}

export function buildDecoratedMessage(
  message: string,
  opts: {
    taskContext?: BrainTaskContext;
    jobContext?: BrainJobContext;
    jobDraft?: boolean;
    repo?: string;
  },
): string {
  // The `repo` JSON field is at most a one-time clone hint Brain consumes to
  // set up a worktree — it never reaches the model's context. State it in the
  // message every turn so the model knows which repo to reason about (and so a
  // dev Brain with no worktree still answers grounded in the right repo).
  const repoPreamble = opts.repo
    ? `[Repository]\nThe user has ${opts.repo} selected in the dashboard. All questions are about this repository unless they say otherwise — inspect its code/issues/PRs for context and refer to it by name.`
    : null;
  const taskPreamble = formatTaskContext(opts.taskContext);
  const jobPreamble = formatJobContext(opts.jobContext);
  const draftPreamble = opts.jobDraft
    ? `[Job drafting mode]
The user is drafting a new Kody job — there is no existing job to look up. A Kody job is a GitHub issue (labelled kody:job) whose markdown body describes intent, system prompt, allowed commands, and restrictions. Ask concrete scoping questions one turn at a time, then produce a copy-ready markdown draft with those four sections so the user can click "Use as job" on your reply.`
    : null;
  const preamble =
    [repoPreamble, draftPreamble, jobPreamble, taskPreamble]
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
    jobContext: input.jobContext,
    jobDraft: input.jobDraft,
    repo: input.repo,
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
  const target = `${input.brainUrl.replace(/\/+$/, "")}/chats/${encodeURIComponent(input.chatId)}/messages`;

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
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": input.brainKey,
      },
      body: JSON.stringify({
        message: decoratedMessage,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(input.repo ? { repo: input.repo } : {}),
        ...(input.repoToken ? { repoToken: input.repoToken } : {}),
        ...(input.voiceMode === true ? { voiceMode: true } : {}),
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
  let assistantBuffer = "";

  const translated = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

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

          switch (ev.type) {
            case "chat":
              // Handshake. Confirms the chatId. Nothing to render.
              break;

            case "text":
              if (typeof ev.text === "string" && ev.text.length > 0) {
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
              // narrated output arrives in the next `text` chunk.
              emit({
                type: "chat.tool_use",
                id: crypto.randomUUID(),
                name: ev.name ?? "tool",
                input: ev.input ?? {},
                timestamp: new Date().toISOString(),
              });
              break;

            case "done":
              emit({ type: "chat.done" });
              break;

            case "error":
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
      const IDLE_TIMEOUT_MS = 120_000;
      const readWithIdleTimeout = () =>
        Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("brain-idle-timeout")),
              IDLE_TIMEOUT_MS,
            ),
          ),
        ]);

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
      } catch (err) {
        const idle =
          err instanceof Error && err.message === "brain-idle-timeout";
        logger.error(
          { err, requestId, chatId: input.chatId, idle },
          idle
            ? "brain-proxy: stream idle timeout (no chunk for 120s)"
            : "brain-proxy: stream read error",
        );
        emit({
          type: "chat.error",
          error: idle
            ? "Brain went silent (no response for 120s) — it may be busy cloning the repo. Try again."
            : "Brain stream interrupted",
        });
        await reader.cancel().catch(() => {});
      } finally {
        controller.close();
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

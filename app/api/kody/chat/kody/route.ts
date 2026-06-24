/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern direct-llm-stream
 *
 * POST /api/kody/chat/kody
 *
 * In-process chat endpoint for the "Kody" agent. Streams replies directly
 * from the configured chat model using the Vercel AI SDK.
 * No GitHub Actions, no VPS, no runner cold start — the request goes
 * straight from the Vercel function to the model and back.
 *
 * Body: {
 *   messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
 *   model?: string   // optional provider-specific model id override
 * }
 *
 * Response: text/plain stream of the assistant reply (AI SDK text stream
 * protocol — client accumulates chunks into the assistant bubble).
 */

import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
} from "ai";
import {
  getAgent,
  isValidAgentId,
  type AgentConfig,
  type AgentId,
} from "@dashboard/lib/agents";
import { applyVoiceOverlay } from "@dashboard/lib/voice/overlay";
import {
  requireKodyAuth,
  getRequestAuth,
  verifyActorLogin,
} from "@dashboard/lib/auth";
import {
  createUserOctokit,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { getSecret } from "@dashboard/lib/vault/get-secret";
import { resolveChatModel } from "../resolve-model";
import { supportsVision } from "@dashboard/lib/chat/vision-support";
import {
  buildSystemPrompt,
  type GoalContext,
  type AgentResponsibilityContext,
  type TaskContext,
  type OrgContext,
} from "./system-prompt";
import {
  loadChatDefaults,
  composeBasePrompt,
  filterToolsByAllowlist,
  buildToolIndex,
  CRITICAL_REMINDERS_MD,
} from "@dashboard/lib/chat-defaults";
import { createGitHubTools } from "../tools/github-tools";
import { createPipelineTools } from "../tools/pipeline-tools";
import { createRemoteTools } from "../tools/remote-tools";
import { createBugTools } from "../tools/bug-tools";
import { createTaskTools } from "../tools/task-tools";
import { createGoalTools } from "../tools/goal-tools";
import { createAgentResponsibilityTools } from "../tools/agent-responsibility-tools";
import { createAgentTools } from "../tools/agent-tools";
import { createMemoryTools } from "../tools/memory-tools";
import { createAgentActionTools } from "../tools/agent-action-tools";
import { createPlannerTools } from "../tools/planner-tools";
import { createReleaseTools } from "../tools/release-tools";
import { createKodyTools } from "../tools/kody-tools";
import { createVibeTools } from "../tools/vibe-tools";
import { applyVibeToolPolicy } from "./vibe-tool-policy";
import { fetchUrlTool } from "../tools/fetch-url";
import { featureTools } from "../tools/feature-tools";
import { uiTools } from "../tools/ui-tools";
import { createCommandTools } from "../tools/commands-tools";
import { createContextTools } from "../tools/context-tools";
import { createTodoTools } from "../tools/todo-tools";
import { createInstructionsTools } from "../tools/instructions-tools";
import { createVariableTools } from "../tools/variables-tools";
import { createSecretTools } from "../tools/secrets-tools";
import { createModelTools } from "../tools/models-tools";
import { createReportTools } from "../tools/reports-tools";
import { createWebhookTools } from "../tools/webhooks-tools";
import { createNotificationTools } from "../tools/notifications-tools";
import { createCompanyTools } from "../tools/company-tools";
import { createInboxTools } from "../tools/inbox-tools";
import { createCmsTools } from "../tools/cms-tools";
import { applyReasoning } from "@dashboard/lib/chat/reasoning-adapter";
import { createAgentAdminTools } from "../tools/agent-admin-tools";
import { createAgentResponsibilityAdminTools } from "../tools/agent-responsibility-admin-tools";
import { createMacroTools } from "../tools/macros-tools";
import {
  invalidateMemoryIndexPromptCache,
  loadMemoryIndexForPrompt,
  readMemoryFile,
  writeMemoryFile,
} from "@dashboard/lib/memory-files";
import { loadInstructionsForPrompt } from "@dashboard/lib/instructions/files";
import { loadContextForPrompt } from "@dashboard/lib/context/files";
import { buildExplicitMemoryDraft } from "./explicit-memory";
import {
  isValidSlug as isValidAgentSlug,
  readResolvedAgentFile,
} from "@dashboard/lib/agent-files";
import {
  appendAgentChatSpeakerOverride,
  buildAgentChatIdentity,
} from "@dashboard/lib/agent-chat-identity";

export const runtime = "nodejs";
// Research turns can chain up to ~10 tool rounds (search → read → blame → …)
// each with its own LLM round-trip. 60s would cut us off mid-stream and the
// UI would hang. 300s is the Vercel Pro ceiling and gives plenty of slack.
export const maxDuration = 300;

// Provider/model are managed entirely from the dashboard. The
// `LLM_MODELS` variable lists user-curated models; each entry binds a
// model to its own `apiKeySecret`, `baseURL`, and wire `protocol`.
// At request time we read the matching secret from the vault and pick
// the SDK based on protocol — `anthropic` for Claude's native Messages
// API (prompt caching + thinking control), `openai` for OpenAI-compat
// endpoints (covers most OpenAI-compatible providers — Groq, OpenRouter,
// Mistral, DeepSeek, xAI, self-hosted LiteLLM, etc).
//
// If no model resolves or the key is missing, the route returns 409
// with `fallback: "kody-live"` so the client routes the same turn
// through the GitHub Actions engine.

interface IncomingTextPart {
  type: "text";
  text: string;
}
interface IncomingImagePart {
  type: "image";
  /** base64 data URL (data:<mime>;base64,<...>) or raw http(s) URL */
  image: string;
  mimeType?: string;
}
interface IncomingFilePart {
  type: "file";
  data: string;
  mediaType: string;
  filename?: string;
}
type IncomingPart = IncomingTextPart | IncomingImagePart | IncomingFilePart;

interface IncomingMessage {
  role: "user" | "assistant" | "system";
  content: string | IncomingPart[];
}

function isPartsArray(c: unknown): c is IncomingPart[] {
  return (
    Array.isArray(c) &&
    c.every((p) => p && typeof p === "object" && "type" in p)
  );
}

/**
 * The Vercel AI SDK accepts an `image` part as either a URL or raw
 * base64-encoded bytes. If we pass a `data:` URL string, it tries to
 * resolve it as a URL and rejects the `data:` scheme. Strip the
 * `data:<mime>;base64,` prefix and recover the mime type from it.
 */
function parseImageData(
  image: string,
  fallbackMime?: string,
): { data: string; mediaType?: string } {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(image);
  if (m) return { data: m[2], mediaType: m[1] || fallbackMime };
  return { data: image, mediaType: fallbackMime };
}

function parseFileData(
  data: string,
  fallbackMime: string,
): { data: string; mediaType: string } {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(data);
  if (m) return { data: m[2], mediaType: m[1] || fallbackMime };
  return { data, mediaType: fallbackMime };
}

// Cap on the number of prior turns we resend to the model. Long histories
// inflate the first round-trip dramatically (especially with thinking
// enabled and 20+ tool schemas), and older messages rarely change the
// next answer. The user-visible chat keeps its full transcript — only
// the request to the model is trimmed.
const MAX_HISTORY_MESSAGES = 50;

/**
 * Default cap on tool-calling rounds per turn. Optimized for deep analysis:
 * the model can run a real research loop (search → read → blame → commits
 * → re-search → …) without the prompt's "no fixed budget" rule getting cut
 * off by the code. The `maxDuration: 300` Vercel ceiling still bounds
 * wall-clock time, and a long turn that runs out of wall-clock is a
 * better failure mode than a mid-investigation cut-off.
 *
 * Per-model override: `maxSteps` on the LLM_MODELS entry wins over this
 * default, so a model that runs longer research chains (e.g. reasoning
 * models that branch more) can be lifted individually without raising the
 * cap for every other model. Pass `null` to disable the cap for a model
 * (rely on `maxDuration` alone).
 */
export const DEFAULT_MAX_STEPS = 100;

// Stream tracing uses console.* (not the pino `logger`) on purpose: pino
// buffers writes asynchronously, and Vercel functions can be killed or
// suspended mid-stream — losing the trail. console.* is line-flushed on
// Vercel's runtime so we always see the events that fired before death.
function traceLog(data: object, msg: string): void {
  console.log(JSON.stringify({ level: "info", msg, ...data }));
}
function traceWarn(data: object, msg: string): void {
  console.warn(JSON.stringify({ level: "warn", msg, ...data }));
}
function traceError(data: object, msg: string): void {
  console.error(JSON.stringify({ level: "error", msg, ...data }));
}

/**
 * Pull the provider's response body out of an AI SDK error. The SDK wraps
 * HTTP errors as `APICallError` with a `responseBody` (raw text) and a
 * `data` field (parsed JSON when available). Without this, a provider 400
 * surfaces as a useless "Bad Request" — with it, the user sees the
 * specific validation message ("tools[7].function.parameters: ...").
 */
interface ProviderErrorLike {
  message?: string;
  name?: string;
  statusCode?: number;
  responseBody?: string;
  url?: string;
  data?: unknown;
  cause?: unknown;
}

function asProviderErrorLike(e: unknown): ProviderErrorLike | null {
  if (!e || typeof e !== "object") return null;
  return e as ProviderErrorLike;
}

function formatProviderError(error: unknown): string {
  const e = asProviderErrorLike(error);
  if (!e) return String(error);
  // Prefer a parsed Google/OpenAI-style { error: { message } } payload.
  const data = e.data as { error?: { message?: string } } | undefined;
  if (data && typeof data === "object") {
    const inner = data.error?.message;
    if (typeof inner === "string" && inner.length > 0) {
      return e.statusCode ? `[${e.statusCode}] ${inner}` : inner;
    }
  }
  // Fall back to the raw response body — clipped so a giant HTML page
  // doesn't poison the UI bubble.
  if (typeof e.responseBody === "string" && e.responseBody.length > 0) {
    const clipped =
      e.responseBody.length > 600
        ? `${e.responseBody.slice(0, 600)}…`
        : e.responseBody;
    return e.statusCode ? `[${e.statusCode}] ${clipped}` : clipped;
  }
  if (typeof e.message === "string" && e.message.length > 0) return e.message;
  return String(error);
}

function extractProviderErrorMeta(error: unknown): Record<string, unknown> {
  const e = asProviderErrorLike(error);
  if (!e) return {};
  const meta: Record<string, unknown> = {};
  if (typeof e.name === "string") meta.errName = e.name;
  if (typeof e.statusCode === "number") meta.statusCode = e.statusCode;
  if (typeof e.url === "string") meta.url = e.url;
  if (typeof e.responseBody === "string") {
    meta.responseBody =
      e.responseBody.length > 1200
        ? `${e.responseBody.slice(0, 1200)}…`
        : e.responseBody;
  }
  return meta;
}

function trimToRecent(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages;
  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
  // Some models reject histories that don't start with a user message. Skip
  // any leading assistant/system messages in the trimmed slice.
  const firstUserIdx = trimmed.findIndex((m) => m.role === "user");
  return firstUserIdx <= 0 ? trimmed : trimmed.slice(firstUserIdx);
}

/** Rebuild a `data:` URL from raw base64 + media type for inlining. */
function toDataUrl(data: string, mediaType?: string): string {
  if (!mediaType || data.startsWith("data:")) return data;
  return `data:${mediaType};base64,${data}`;
}

/**
 * Collapse multimodal user turns into plain text for a text-only model.
 * A model with no vision (e.g. MiniMax) either rejects an image part or
 * silently drops it; inlining the image data URL into the text keeps the
 * attachment on the one channel every model reads. Vision models skip this
 * and keep real image parts. Assistant/system turns are already strings.
 */
function inlineImagePartsForTextModel(
  messages: ModelMessage[],
): ModelMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string" || !Array.isArray(m.content)) return m;
    const text = m.content
      .map((p) => {
        if (p.type === "text") return p.text;
        if (p.type === "image") {
          const img = typeof p.image === "string" ? p.image : "";
          return img ? `[Image]\n${toDataUrl(img, p.mediaType)}` : "";
        }
        if (p.type === "file") {
          const data = typeof p.data === "string" ? p.data : "";
          const label = p.filename ? `[File: ${p.filename}]` : "[File]";
          return data ? `${label}\n${toDataUrl(data, p.mediaType)}` : "";
        }
        return "";
      })
      .filter((t) => t !== "")
      .join("\n\n");
    return { ...m, content: text } as ModelMessage;
  });
}

function normalizeMessages(raw: IncomingMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of raw) {
    if (
      !m ||
      (m.role !== "user" && m.role !== "assistant" && m.role !== "system")
    )
      continue;

    if (typeof m.content === "string") {
      if (m.content.trim() === "") continue;
      out.push({ role: m.role, content: m.content } as ModelMessage);
      continue;
    }

    if (!isPartsArray(m.content)) continue;

    // Multimodal parts are only valid on a user message in the SDK shape.
    // Strip empty text parts; drop the message if nothing remains.
    const parts = m.content
      .map((p) => {
        if (p.type === "text") {
          return p.text.trim() === ""
            ? null
            : { type: "text" as const, text: p.text };
        }
        if (p.type === "image") {
          const parsed = parseImageData(p.image, p.mimeType);
          return {
            type: "image" as const,
            image: parsed.data,
            ...(parsed.mediaType ? { mediaType: parsed.mediaType } : {}),
          };
        }
        if (p.type === "file") {
          const parsed = parseFileData(p.data, p.mediaType);
          return {
            type: "file" as const,
            data: parsed.data,
            mediaType: parsed.mediaType,
            ...(p.filename ? { filename: p.filename } : {}),
          };
        }
        return null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (parts.length === 0) continue;
    if (m.role === "user") {
      out.push({ role: "user", content: parts });
    } else {
      // assistant/system can't carry image parts — collapse to text only.
      const text = parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      if (text.trim() === "") continue;
      out.push({ role: m.role, content: text } as ModelMessage);
    }
  }
  return out;
}

function getLatestUserText(messages: ModelMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (!Array.isArray(message.content)) continue;
    const text = message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (text.length > 0) return text;
  }
  return null;
}

export async function POST(req: NextRequest) {
  // Short trace ID lets us follow a single chat request through every log
  // line (start, per-tool start/finish, per-step finish, errors, finish).
  // Grep `vercel logs` for the ID to see one session's full trace.
  const traceId = randomBytes(4).toString("hex");
  const reqStartedAt = Date.now();

  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  // Key resolution is per-model: each LLM_MODELS entry names which secret
  // to read at request time. We defer the actual lookup until after we
  // resolve the model below, so a missing key on model X never blocks
  // model Y.

  let body: {
    messages?: IncomingMessage[];
    model?: string;
    task?: TaskContext;
    /** GitHub login of the requester — gates remote_* tools. Optional. */
    actorLogin?: string;
    /** Current agentResponsibility context — scopes the chat to a specific agentResponsibility folder. */
    agentResponsibility?: AgentResponsibilityContext;
    /**
     * When true, append the mission-planning block to the system prompt and
     * wire the planner tools (`create_task_for_goal`). `goal` must be set.
     */
    goalPlanner?: boolean;
    /** The goal this planner session is scoped to. */
    goal?: GoalContext;
    /** Currently-viewed report on /reports — scopes the chat to advise on it. */
    report?: { slug: string; title: string; body: string };
    /** Org workspace scope from /org/:org. */
    org?: OrgContext;
    /**
     * The dashboard page the user is currently viewing, as a noun phrase
     * (e.g. "the Variables page (/variables)"). Surfaced as a `## Current
     * page` system section so "what am I looking at?" resolves.
     */
    currentPage?: string;
    /**
     * Which agentIdentity to use for the system prompt. Defaults to `kody`.
     * Any agent whose backend is `kody-direct` is served natively here;
     * agents whose backend is the engine, brain, or kody-live don't have
     * their prompts proxied through this route, so the route falls back to
     * `AGENT_KODY`'s prompt for those (the dashboard reaches this route in
     * voice mode regardless of selected agent — voice is a modality, not a
     * backend swap).
     */
    agentId?: AgentId;
    /**
     * Repo/store agent identity slug addressed with `@slug` in chat. This is
     * a prompt identity swap for this in-process turn, not a runner dispatch.
     */
    agentSlug?: string;
    /**
     * Voice modality. When true the server appends `VOICE_OVERLAY_PROMPT`
     * to the resolved agent's base prompt (no markdown, short sentences,
     * symbols read aloud as words), disables thinking/reasoning streaming,
     * and prefers a model flagged `speech: true` in `LLM_MODELS` when the
     * client hasn't pinned a model explicitly. The chosen agent's brain
     * and tools stay in charge — only the output shape changes.
     */
    voiceMode?: boolean;
    /**
     * Vibe mode. When true the chat is scoped to the selected vibe task and
     * the prompt flips to "you ARE the executor — drive Kody Live/Fly, open
     * PRs directly, never dispatch @kody". The Kody-dispatch tools are
     * stripped from the tool set so the model can't trigger the pipeline.
     */
    vibeMode?: boolean;
    /**
     * User-picked thinking level for the resolved model. Validated against
     * the model's declared `reasoning.efforts` — unknown values fall back
     * to `reasoning.default`. Translated to the provider's wire shape
     * (anthropic_budget, openai_effort, …) by `applyReasoning()` before
     * being merged into `streamText` options. Omitted when the model has
     * no reasoning config — `applyReasoning` then returns `{}`.
     */
    reasoningEffort?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allMessages = normalizeMessages(body.messages ?? []);
  if (allMessages.length === 0) {
    return NextResponse.json(
      { error: "messages required (non-empty)" },
      { status: 400 },
    );
  }
  const messages = trimToRecent(allMessages);
  const trimmedCount = allMessages.length - messages.length;

  // Resolve the model from the user-managed list in .kody/variables.json.
  // The client can override per-request via `body.model`, but it must
  // match an enabled entry — we never trust arbitrary ids from the wire.
  // Voice mode does not affect model selection; it's a per-turn prompt
  // overlay only (see system-prompt builder).
  const voiceMode = body.voiceMode === true;
  // Model resolution (list → pick → key → SDK) is shared with the title
  // route via resolveChatModel so the two can't drift. Voice mode does
  // not affect model selection; it's a per-turn prompt overlay only.
  const resolution = await resolveChatModel(req, body.model);
  if ("error" in resolution) return resolution.error;
  const { model, resolvedModel } = resolution;
  const modelId = resolvedModel.id;
  const actorResult = await verifyActorLogin(req, body.actorLogin);
  if (actorResult instanceof NextResponse) return actorResult;
  const verifiedActorLogin = actorResult.identity.login;
  // Only vision-capable models get real image parts. For text-only models
  // (looked up from LiteLLM's supports_vision data) inline the image as text
  // so the attachment still rides along instead of being dropped/rejected.
  const modelIsVision =
    supportsVision(resolvedModel.id) || supportsVision(resolvedModel.modelName);
  let modelMessages = modelIsVision
    ? messages
    : inlineImagePartsForTextModel(messages);
  const repo = getRequestAuth(req);
  const goalPlannerActive = body.goalPlanner === true && !!body.goal;

  // Memory index injection requires the github-client module-level context
  // (the cached loader uses `getOctokit()` / `getOwner()` / `getRepo()`).
  // Set the context here, before buildSystemPrompt, and rely on the
  // existing onFinish / catch paths to clear it. Per-request octokits
  // for GitHub tools are still created separately below to avoid races.
  let memoryIndex: string | null = null;
  let userInstructions: string | null = null;
  let context: string | null = null;
  if (repo) {
    setGitHubContext(
      repo.owner,
      repo.repo,
      repo.token,
      repo.storeRepoUrl,
      repo.storeRef,
    );
    try {
      memoryIndex = await loadMemoryIndexForPrompt();
    } catch (err) {
      // Memory is best-effort; never block the chat. Log and continue.
      traceWarn(
        { traceId, err: err instanceof Error ? err.message : String(err) },
        "kody-direct: memory index load failed (continuing without it)",
      );
    }
    try {
      userInstructions = await loadInstructionsForPrompt();
    } catch (err) {
      // Instructions are best-effort; never block the chat. Log and continue.
      traceWarn(
        { traceId, err: err instanceof Error ? err.message : String(err) },
        "kody-direct: user instructions load failed (continuing without them)",
      );
    }
    try {
      context = await loadContextForPrompt();
    } catch (err) {
      // Context is best-effort; never block the chat. Log and continue.
      traceWarn(
        { traceId, err: err instanceof Error ? err.message : String(err) },
        "kody-direct: context load failed (continuing without it)",
      );
    }
  }

  // Pick the agentIdentity. Agents whose backend is `kody-direct` are
  // served natively here; the rest (engine, brain, kody-live) don't have
  // a usable in-process prompt to swap in.
  //
  // For text turns we fall back to AGENT_KODY for non-direct agents so
  // older clients keep working (the dashboard UI never routes a brain or
  // engine TEXT turn here, but defense-in-depth).
  //
  // For VOICE turns we refuse the request instead of silently falling
  // back. Voice was the source of an actual user-visible bug: the
  // dropdown said "brain-fly" while the mic produced an in-process
  // chat answer. The mic is also gated client-side now (see KodyChat
  // VoiceButton), so a voice turn with a non-direct agent is either a
  // stale client or someone calling the API directly — neither should
  // be answered as Kody.
  const requestedAgentId =
    body.agentId && isValidAgentId(body.agentId) ? body.agentId : "kody";
  const requestedAgent: AgentConfig = getAgent(requestedAgentId);
  if (voiceMode && requestedAgent.backend !== "kody-direct") {
    return NextResponse.json(
      {
        error: "voice_not_supported_for_agent",
        message: `Voice mode requires a kody-direct agent. "${requestedAgent.name}" runs on ${requestedAgent.backend}; the voice overlay can't be applied there. Switch to a Kody (in-process) agent in the dropdown to use the mic.`,
      },
      { status: 400 },
    );
  }

  const explicitMemoryDraft = buildExplicitMemoryDraft(
    getLatestUserText(messages) ?? "",
  );
  if (repo && explicitMemoryDraft) {
    try {
      const octokit = createUserOctokit(repo.token);
      const existing = await readMemoryFile(explicitMemoryDraft.id);
      const file = await writeMemoryFile({
        octokit,
        id: explicitMemoryDraft.id,
        sha: existing?.sha,
        meta: {
          name: explicitMemoryDraft.name,
          description: explicitMemoryDraft.description,
          type: explicitMemoryDraft.type,
          created: existing?.meta.created ?? new Date().toISOString(),
        },
        body: explicitMemoryDraft.body,
        message: `chore(memory): ${existing ? "update" : "add"} ${
          explicitMemoryDraft.id
        }${verifiedActorLogin ? ` (via chat by @${verifiedActorLogin})` : ""}`,
      });
      invalidateMemoryIndexPromptCache();
      modelMessages = [
        ...modelMessages,
        {
          role: "system",
          content:
            `Explicit memory request already persisted to .kody/memory/${file.id}.md ` +
            `as ${file.meta.type}. Do not call remember/update_memory again. ` +
            "Briefly confirm it was saved.",
        },
      ];
    } catch (err) {
      modelMessages = [
        ...modelMessages,
        {
          role: "system",
          content:
            "Explicit memory request could not be persisted before response. " +
            `Tell the user it failed and include this error: ${
              err instanceof Error ? err.message : String(err)
            }`,
        },
      ];
    }
  }
  const vibeMode = body.vibeMode === true;

  // In vibe mode the agent decides Fly vs. Live without asking. Probe
  // the vault for FLY_API_TOKEN so the prompt can tell the agent which
  // runner is actually configured for THIS user — Fly is opt-in, not
  // default. Outside vibe mode this signal isn't used, so skip the
  // vault read on the hot path.
  let flyConfigured = false;
  if (vibeMode) {
    try {
      const flyToken = await getSecret("FLY_API_TOKEN", { req });
      flyConfigured = Boolean(flyToken && flyToken.trim().length > 0);
    } catch {
      flyConfigured = false;
    }
  }

  // Load the chat defaults bundle — agentIdentity + agentAction + agentResponsibilities + skills.
  // The bundle is the source of truth for the chat's prompt base + tool
  // allowlist. Repo-stored with a TS fallback; step 1 returns TS defaults.
  const chatBundle = await loadChatDefaults(repo?.owner, repo?.repo);
  const agentSlug =
    typeof body.agentSlug === "string" ? body.agentSlug.trim() : "";
  let activeAgentIdentity = chatBundle.agentIdentity;
  let addressedAgentMember: Awaited<ReturnType<typeof readResolvedAgentFile>> =
    null;
  if (agentSlug) {
    if (!isValidAgentSlug(agentSlug)) {
      clearGitHubContext();
      return NextResponse.json(
        { error: "invalid_agent_slug" },
        { status: 400 },
      );
    }
    if (!repo) {
      return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
    }
    let agentMember;
    try {
      agentMember = await readResolvedAgentFile(
        agentSlug,
        createUserOctokit(repo.token),
      );
    } catch (err) {
      clearGitHubContext();
      throw err;
    }
    if (!agentMember) {
      clearGitHubContext();
      return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
    }
    activeAgentIdentity = buildAgentChatIdentity(agentMember);
    addressedAgentMember = agentMember;
  }

  // Build the per-request tool set FIRST. The tool list feeds into the
  // system prompt as a `## Tool index` block (item 1 of the accuracy
  // improvements) — the model picks the right tool from the descriptions,
  // not by guessing from names. Tool building requires repo + actor
  // resolution done above.
  const baseTools: Record<string, unknown> = {
    fetch_url: fetchUrlTool,
    ...featureTools,
    ...uiTools,
  };
  let extraTools: Record<string, unknown> = {};
  if (repo) {
    // Per-request Octokit (no shared singleton) so the GitHub tools
    // don't race other concurrent /api/kody/chat/kody requests.
    const octokit = createUserOctokit(repo.token);
    extraTools = {
      ...extraTools,
      ...createGitHubTools({ octokit, owner: repo.owner, repo: repo.repo }),
      ...createBugTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createTaskTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createGoalTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
      }),
      ...createAgentResponsibilityTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createAgentTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createMemoryTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createReleaseTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createKodyTools({ octokit, owner: repo.owner, repo: repo.repo }),
      ...createAgentActionTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      // Dashboard-management tools: let chat manage every dashboard feature
      // (config files, settings, infra) the same way the pages do. Reads use
      // the module-level GitHub context set above; writes pass this octokit.
      ...createCommandTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createContextTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createTodoTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createInstructionsTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createVariableTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createSecretTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createModelTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createReportTools({ owner: repo.owner, repo: repo.repo }),
      ...createNotificationTools({ owner: repo.owner, repo: repo.repo }),
      ...createCompanyTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createWebhookTools({
        token: repo.token,
        owner: repo.owner,
        repo: repo.repo,
      }),
      ...createInboxTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
      }),
      ...createAgentAdminTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createAgentResponsibilityAdminTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createMacroTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      // Vibe-only: pre-create branch + draft PR so Vercel cold-builds in
      // parallel with the runner warmup. Stripped from the tool set when
      // not in vibe mode below (alongside the @kody dispatch tools).
      // When scoped to a task, bind the hand-off to that issue so a
      // mis-guessed issueNumber from the model can't mis-target the runner.
      ...createVibeTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        currentIssueNumber:
          vibeMode && body.task?.issueNumber != null
            ? Number(body.task.issueNumber)
            : undefined,
      }),
      ...(goalPlannerActive && body.goal
        ? createPlannerTools({
            octokit,
            owner: repo.owner,
            repo: repo.repo,
            actorLogin: verifiedActorLogin,
            goalId: body.goal.id,
          })
        : {}),
    };
    // Pipeline tools currently use github-client's module-level context
    // (already set above for the memory index loader) — they do *not* take
    // the per-request octokit. Concurrent requests can race that state;
    // we accept the existing risk to reuse cached helpers.
    extraTools = {
      ...extraTools,
      ...createPipelineTools({ owner: repo.owner, repo: repo.repo }),
    };
  }
  extraTools = {
    ...extraTools,
    ...createRemoteTools(verifiedActorLogin),
  };
  if (repo) {
    const octokit = createUserOctokit(repo.token);
    extraTools = {
      ...extraTools,
      ...(await createCmsTools({
        req,
        octokit,
        owner: repo.owner,
        repo: repo.repo,
      })),
    };
  }
  // Vibe tool policy (see vibe-tool-policy.ts): strips the `@kody` dispatch
  // tools in vibe mode, strips issue-creation tools once a task is scoped
  // (so the model can't file a duplicate), and removes vibe_start_execution
  // outside vibe.
  const mergedTools = applyVibeToolPolicy(
    { ...baseTools, ...extraTools },
    { vibeMode, hasCurrentTask: body.task?.issueNumber != null },
  );
  // Bundle allowlist — the agentAction's `tools` field is the single source
  // of truth for which tools the chat exposes. Empty list = expose all
  // (preserves current behavior when the bundle is unconfigured).
  const allowlistedTools = filterToolsByAllowlist(
    mergedTools,
    chatBundle.agentAction.tools,
  );
  const tools = allowlistedTools as Parameters<typeof streamText>[0]["tools"];

  // Build the system prompt. The tool index (name + description) is
  // computed from the FINAL allowlisted tools and injected into the
  // bundle's base prompt — the model sees a `## Tool index` block
  // listing every callable with a one-sentence description, so it
  // picks the right tool instead of guessing by name.
  const toolIndex = buildToolIndex(allowlistedTools);

  const basePrompt = composeBasePrompt(
    { ...chatBundle, agentIdentity: activeAgentIdentity },
    { toolIndex },
  );
  const assembledPrompt = buildSystemPrompt(
    basePrompt,
    repo ? { owner: repo.owner, repo: repo.repo } : null,
    body.task,
    {
      agentResponsibility: body.agentResponsibility,
      goalPlanner: goalPlannerActive,
      goal: goalPlannerActive ? body.goal : undefined,
      report: body.report,
      org: body.org,
      currentPage: body.currentPage,
      memoryIndex,
      vibeMode,
      flyConfigured,
      userInstructions,
      context,
    },
  );

  // Critical reminders appended LAST among the static rules (recency
  // bias) so the model holds them through the runtime blocks. The voice
  // overlay still wins over these when voice is on (applied next).
  const promptWithReminders = voiceMode
    ? assembledPrompt
    : `${assembledPrompt}\n\n${CRITICAL_REMINDERS_MD}`;
  const promptWithSpeakerOverride = appendAgentChatSpeakerOverride(
    promptWithReminders,
    addressedAgentMember,
  );

  // Voice modality is layered onto the FULLY-ASSEMBLED prompt, appended
  // LAST so its rules ("no markdown, short sentences, symbols-as-words")
  // win by recency over the research/issue-creation/memory blocks above
  // which otherwise teach the model to reply in bullet-heavy markdown.
  // The agent's brain and tools are untouched — the user picks the brain
  // in the dropdown; only the output shape changes.
  const systemPrompt = applyVoiceOverlay(promptWithSpeakerOverride, voiceMode);

  // Build a tool-name → description map from the merged tool set. Every
  // tool in this repo calls `tool({ description, inputSchema, execute })`
  // from the AI SDK, which returns a runtime object with `description` as
  // a first-class field. We ship the map to the client as a single
  // `data-tools-index` event at the start of the stream so the thinking
  // panel can render the tool description (the same string the model uses
  // to decide whether to call a tool) as a muted one-liner under the tool
  // name. One event for the whole turn, not one per call — see issue #321.
  // Brain/Engine chats don't populate this; the client field is optional
  // and the card gracefully omits the line when missing.
  const toolDescriptionByName: Record<string, string> = {};
  for (const [name, t] of Object.entries(tools ?? {})) {
    const desc =
      t && typeof t === "object" && "description" in t
        ? (t as { description?: unknown }).description
        : undefined;
    if (typeof desc === "string" && desc.trim().length > 0) {
      toolDescriptionByName[name] = desc;
    }
  }

  let stepNum = 0;

  // Heartbeat warnings. If no step has finished by T+30s/T+60s, log a
  // warning so we can spot first-step stalls (the model taking forever before
  // any tokens / tool calls). Cleared at first step finish, completion, or
  // any error path. Declared outside the try so the catch can clear them.
  const heartbeats: NodeJS.Timeout[] = [];
  const armHeartbeat = (ms: number) => {
    heartbeats.push(
      setTimeout(() => {
        if (stepNum === 0) {
          traceWarn(
            { traceId, elapsedMs: ms, messageCount: messages.length, modelId },
            "kody-direct: no step finished yet (model may be stuck before first token)",
          );
        }
      }, ms),
    );
  };
  const clearHeartbeats = () => {
    for (const h of heartbeats) clearTimeout(h);
    heartbeats.length = 0;
  };

  try {
    traceLog(
      {
        traceId,
        modelId,
        messageCount: messages.length,
        trimmedFromHistory: trimmedCount,
        repo: repo ? `${repo.owner}/${repo.repo}` : null,
        task: body.task?.issueNumber ?? null,
        toolCount: Object.keys(tools ?? {}).length,
      },
      "kody-direct: streaming",
    );
    armHeartbeat(30_000);
    armHeartbeat(60_000);
    const result = streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
      tools,
      // Optimized for deep analysis: see DEFAULT_MAX_STEPS for the cap
      // rationale and the per-model override path. The constant lives at
      // module level so tests can assert the value.
      stopWhen: stepCountIs(resolvedModel.maxSteps ?? DEFAULT_MAX_STEPS),
      // Per-provider thinking config so reasoning-delta chunks actually
      // reach the client. Without this, `sendReasoning: true` below has
      // nothing to stream and the chat looks idle until the final answer.
      // Voice mode skips reasoning entirely — the voice overlay forbids
      // reading anything other than the final answer, and the chat client
      // also drops reasoning chunks defensively in this mode.
      // `applyReasoning` is the single source of truth for the
      // effort→wire-shape translation; the user-picked level is forwarded
      // as `body.reasoningEffort` and validated against the model's
      // declared `efforts` list. Returns `{}` for models that don't
      // reason, so non-reasoning providers stay untouched.
      ...(voiceMode ? {} : applyReasoning(resolvedModel, body.reasoningEffort)),
      // Per-tool tracing. `experimental_onToolCallStart` fires before the
      // tool's `execute` is invoked; `experimental_onToolCallFinish`
      // afterward with the SDK-measured `durationMs` and a success flag.
      // Together with onStepFinish they give us a per-step, per-tool view
      // of where time goes.
      experimental_onToolCallStart: ({ toolCall }) => {
        traceLog(
          {
            traceId,
            tool: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
          },
          "kody-direct: tool start",
        );
      },
      experimental_onToolCallFinish: (event) => {
        const base = {
          traceId,
          tool: event.toolCall.toolName,
          toolCallId: event.toolCall.toolCallId,
          durationMs: event.durationMs,
        };
        if (event.success) {
          traceLog(base, "kody-direct: tool ok");
        } else {
          traceWarn(
            {
              ...base,
              err:
                event.error instanceof Error
                  ? event.error.message
                  : String(event.error),
            },
            "kody-direct: tool error",
          );
        }
      },
      onStepFinish: (step) => {
        stepNum++;
        if (stepNum === 1) clearHeartbeats();
        traceLog(
          {
            traceId,
            step: stepNum,
            finishReason: step.finishReason,
            toolCalls: step.toolCalls?.map((c) => c.toolName) ?? [],
            usage: step.usage,
          },
          "kody-direct: step finish",
        );
      },
      onError: ({ error }) => {
        clearHeartbeats();
        // Server-side log of stream errors. We *also* surface the message
        // to the UI via the `onError` arg to toUIMessageStreamResponse
        // below, so the user sees what happened instead of a silent hang.
        traceError(
          {
            traceId,
            modelId,
            err: formatProviderError(error),
            ...extractProviderErrorMeta(error),
          },
          "kody-direct: stream onError",
        );
      },
      onFinish: (event) => {
        clearHeartbeats();
        clearGitHubContext();
        traceLog(
          {
            traceId,
            steps: stepNum,
            finishReason: event.finishReason,
            totalDuration: Date.now() - reqStartedAt,
            usage: event.usage,
          },
          "kody-direct: finish",
        );
      },
    });
    // Prepend a single `data-tools-index` event to the UI stream so the
    // client can hydrate a name→description lookup for the thinking panel.
    // One event for the whole turn (not one per tool call) — see the
    // `toolDescriptionByName` build above for the why. We do this through
    // `createUIMessageStream` so the description map is the first chunk the
    // client sees; the rest of the stream is the same `result.toUIMessageStream`
    // the SDK would have produced on its own.
    const uiStream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({
          type: "data-tools-index",
          data: toolDescriptionByName,
        });
        writer.merge(result.toUIMessageStream({ sendReasoning: true }));
      },
      onError: (error) => {
        clearHeartbeats();
        const msg = formatProviderError(error);
        traceError(
          { traceId, err: msg, ...extractProviderErrorMeta(error) },
          "kody-direct: ui-stream onError",
        );
        return `[trace ${traceId}] ${msg}`;
      },
    });
    return createUIMessageStreamResponse({ stream: uiStream });
  } catch (err) {
    clearHeartbeats();
    clearGitHubContext();
    const msg = formatProviderError(err);
    traceError(
      { traceId, err: msg, ...extractProviderErrorMeta(err) },
      "kody-direct: stream failed",
    );
    return NextResponse.json({ error: msg, traceId }, { status: 500 });
  }
}

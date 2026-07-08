/**
 * @fileType util
 * @domain kody
 * @pattern reasoning-adapter
 * @ai-summary Translates a user-facing thinking level ("off", "low", "medium",
 *   "high", …) into the per-provider wire shape. This is the ONLY place in the
 *   codebase that knows about provider-specific reasoning field names
 *   (Anthropic `thinking.budgetTokens`, OpenAI `reasoning_effort`, OpenRouter
 *   `extraBody.reasoning.effort`, Google `thinkingConfig.thinkingBudget`,
 *   xAI `reasoningEffort`). Everything else — the chat UI, the model schema,
 *   the persistence layer — uses the canonical `off/low/medium/high` (etc.)
 *   vocabulary.
 *
 *   Per-model capability is declared on the `ChatModel.reasoning` block
 *   (see `src/dashboard/lib/variables/models.ts`). When that block is absent
 *   the adapter returns `{}` — the route spreads nothing into `streamText`,
 *   and the provider's default behavior applies (no reasoning for most
 *   models, always-on for hard-coded reasoning models like o1).
 *
 *   The lookup table at the bottom auto-fills a sensible default
 *   `reasoning` block for well-known model-name prefixes when the model
 *   entry doesn't declare one explicitly. Users can override per-entry in
 *   Models settings.
 */

/** Wire formats the chat route can spread into `streamText` `providerOptions`. */
export type ReasoningWire =
  | "anthropic_budget"
  | "openai_effort"
  | "openai_extra_body"
  | "gemini_budget"
  | "gemini_level"
  | "xai_effort";

/** A single user-facing level shown in the chat dropdown. */
export interface ReasoningEffort {
  value: string;
  label: string;
}

/** Canonical shape of the per-model `reasoning` block. */
export interface ModelReasoning {
  efforts: ReasoningEffort[];
  default: string;
  wire: ReasoningWire;
}

interface ModelLike {
  id?: string;
  label?: string;
  provider?: string;
  modelName?: string;
  protocol?: string;
  reasoning?: ModelReasoning | null;
}

/** Canonical vocabulary used by every adapter. Order matters — index 0 is "off". */
export const STANDARD_EFFORTS: ReasoningEffort[] = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/** Same as above with GPT-5's `minimal` slot. */
export const GPT5_EFFORTS: ReasoningEffort[] = [
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/** `o1` / `o3` are always-on; the dropdown collapses to a single "On" pill. */
export const ALWAYS_ON_EFFORTS: ReasoningEffort[] = [
  { value: "on", label: "On" },
];

/** Grok 4 ships only Off / Low / High. */
export const GROK_EFFORTS: ReasoningEffort[] = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
];

// Anthropic extended-thinking budget. Index-aligned with STANDARD_EFFORTS:
// off → block omitted; low → 2k; medium → 10k; high → 32k. Numbers picked
// to match what the model family actually uses in production prompts.
const ANTHROPIC_BUDGET_FOR_EFFORT: Record<string, number> = {
  low: 2048,
  medium: 10_000,
  high: 32_000,
};

// Google Gemini 2.5 thinkingBudget. `0` means "no thinking" — the SDK
// accepts that as an explicit off-switch (omitting the field falls back to
// a model default which is usually ON, so we can't just drop the block).
const GEMINI_BUDGET_FOR_EFFORT: Record<string, number> = {
  off: 0,
  low: 1024,
  medium: 8_192,
  high: 24_576,
};

function isOff(effort: string | undefined | null): boolean {
  return !effort || effort === "off";
}

/**
 * Translate the user-facing effort into the `streamText` options fragment
 * the chat route spreads in. Returns `{}` when the model has no
 * `reasoning` block (provider default applies) or when the chosen effort
 * is not in the model's declared list (we silently fall back to the
 * model's default rather than fail the request).
 */
export function applyReasoning(
  model: ModelLike | null | undefined,
  effort: string | null | undefined,
): Record<string, unknown> {
  if (!model || !model.reasoning) return {};
  const r = model.reasoning;
  const declared = r.efforts.some((e) => e.value === effort);
  const effective = declared && effort ? effort : r.default;

  // `off` is the special case that depends on the wire format. Most wires
  // can simply omit the field; Anthropic MUST omit the entire `thinking`
  // block (it changes request semantics — prompt caching, interleaved-
  // thinking beta); Gemini 2.5 must send `thinkingBudget: 0` explicitly.
  if (isOff(effective)) {
    if (r.wire === "anthropic_budget") return {};
    if (r.wire === "gemini_budget") {
      return {
        providerOptions: {
          google: { thinkingConfig: { thinkingBudget: 0 } },
        },
      };
    }
    return {};
  }

  switch (r.wire) {
    case "anthropic_budget":
      return {
        providerOptions: {
          anthropic: {
            thinking: {
              type: "enabled",
              budgetTokens: ANTHROPIC_BUDGET_FOR_EFFORT[effective] ?? 5_000,
            },
          },
        },
      };
    case "openai_effort":
      return {
        providerOptions: { openai: { reasoningEffort: effective } },
      };
    case "openai_extra_body":
      return {
        providerOptions: {
          openai: { extraBody: { reasoning: { effort: effective } } },
        },
      };
    case "gemini_budget":
      return {
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingBudget: GEMINI_BUDGET_FOR_EFFORT[effective] ?? 8_192,
            },
          },
        },
      };
    case "gemini_level":
      return {
        providerOptions: {
          google: { thinkingConfig: { thinkingLevel: effective } },
        },
      };
    case "xai_effort":
      return {
        providerOptions: { xai: { reasoningEffort: effective } },
      };
  }
}

/**
 * Auto-detect a sensible `reasoning` block for a model entry that doesn't
 * declare one. Match is case-insensitive substring on `modelName`. Order
 * matters — more specific patterns (GPT-5, o1) come before looser ones
 * (claude).
 */
export function defaultReasoningForModel(
  model: ModelLike,
): ModelReasoning | null {
  const name = (model.modelName ?? model.id ?? "").toLowerCase();
  if (!name) return null;

  // Always-on reasoning families — single-entry "On" pill.
  if (
    /\bo1\b/.test(name) ||
    /\bo3\b/.test(name) ||
    /\bdeepseek-r1\b/.test(name)
  ) {
    return {
      efforts: ALWAYS_ON_EFFORTS,
      default: "on",
      wire: "openai_effort",
    };
  }

  // GPT-5 family — Off / Minimal / Low / Medium / High.
  if (/\bgpt-5/.test(name)) {
    return {
      efforts: GPT5_EFFORTS,
      default: "medium",
      wire: "openai_effort",
    };
  }

  // Gemini 3 uses `thinkingLevel`; Gemini 2.5 uses `thinkingBudget`.
  if (/gemini-3/.test(name) || /gemini 3/.test(name)) {
    return {
      efforts: STANDARD_EFFORTS,
      default: "medium",
      wire: "gemini_level",
    };
  }
  if (/gemini-2\.5/.test(name) || /gemini 2\.5/.test(name)) {
    return {
      efforts: STANDARD_EFFORTS,
      default: "medium",
      wire: "gemini_budget",
    };
  }

  // Grok 4 — Off / Low / High only.
  if (/grok-?4/.test(name) || /grok 4/.test(name)) {
    return {
      efforts: GROK_EFFORTS,
      default: "low",
      wire: "xai_effort",
    };
  }

  // Mistral Magistral — Off / Low / Medium / High, OpenAI-style effort.
  if (/magistral/.test(name)) {
    return {
      efforts: STANDARD_EFFORTS,
      default: "medium",
      wire: "openai_extra_body",
    };
  }

  // MiniMax (M2.x / M3 / …) — OpenAI-compatible Chat Completions API.
  // The provider accepts `reasoning_effort` on supported models (M3 has
  // a thinking mode exposed in OpenCode). Effort is "low" by default to
  // match the model family's typical routing.
  if (/\bminimax\b/.test(name) || /\bminimax[- ]?m\d/i.test(name)) {
    return {
      efforts: STANDARD_EFFORTS,
      default: "low",
      wire: "openai_effort",
    };
  }

  // Anthropic Claude — extended thinking with budget tokens. Use the
  // OpenAI-compatible adapter for Claude-via-OpenRouter (extraBody), and
  // the native Anthropic protocol otherwise. We default the wire format
  // to native when the entry's protocol says anthropic; that's the
  // expected default. Callers can override on the model entry.
  if (/claude/.test(name)) {
    return {
      efforts: STANDARD_EFFORTS,
      default: "medium",
      wire:
        model.protocol === "anthropic"
          ? "anthropic_budget"
          : "openai_extra_body",
    };
  }

  return null;
}

/**
 * Fallback `reasoning` block for gateway models that have no explicit
 * `reasoning` config AND no match in the auto-detect table. Always
 * rendered so the user can pick a level on any model — they can then
 * fix the wire format in `/models` if the default isn't right.
 *
 * Default is `openai_effort` because (a) it's the most common OpenAI-
 * compatible wire shape, and (b) the route-side validation accepts the
 * field at the top level of the request — the worst case for a model
 * that doesn't understand the param is a provider that ignores it (most
 * do) or a 400 (rare; the user sees the error and can flip the wire in
 * `/models` to silence it).
 */
export const FALLBACK_REASONING: ModelReasoning = {
  efforts: STANDARD_EFFORTS,
  default: "off",
  wire: "openai_effort",
};

/**
 * Resolve the effective `reasoning` block for a model: the entry's own
 * declaration wins, otherwise the auto-detect table, otherwise the
 * safe default. The UI uses this to decide whether to render the
 * dropdown (it always renders for gateway models now); the route uses
 * `applyReasoning` to translate the chosen level.
 */
export function resolveReasoning(
  model: ModelLike | null | undefined,
): ModelReasoning | null {
  if (!model) return null;
  if (model.reasoning) return model.reasoning;
  return defaultReasoningForModel(model) ?? FALLBACK_REASONING;
}

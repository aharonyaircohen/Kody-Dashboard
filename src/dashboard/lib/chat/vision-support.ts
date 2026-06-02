/**
 * @fileType utility
 * @domain chat
 * @pattern capability-lookup
 * @ai-summary Decide whether a chat model can accept images. Seeded from
 *   LiteLLM's `supports_vision` data (model_prices_and_context_window.json),
 *   collapsed to family-level patterns so it covers new point-releases without
 *   per-model maintenance. Unknown models return `false` so the caller falls
 *   back to inlining the image as text — the safe default that never sends an
 *   image_url a text-only model (e.g. MiniMax) would choke on or ignore.
 */

/**
 * Model-name patterns whose families LiteLLM marks `supports_vision: true`.
 * Matched case-insensitively against the full spec (`provider/model` or bare
 * model name), so `google/gemini-2.5-pro` and `gemini-2.5-pro` both hit.
 *
 * Keep this positive-only: anything not listed is treated as text-only. That
 * makes a missing entry fail safe (inline) rather than fail loud (broken
 * image_url). To add a model, add its family here — mirror LiteLLM's flag.
 */
const VISION_MODEL_PATTERNS: RegExp[] = [
  // Anthropic — every Claude 3.x and 4.x is multimodal.
  /claude-3/,
  /claude-(opus|sonnet|haiku)-4/,
  /claude-4/,
  // OpenAI — 4o / 4.1 / 4-turbo / 4-vision, GPT-5, and the o3/o4 reasoners.
  /gpt-4o/,
  /gpt-4\.1/,
  /gpt-4-turbo/,
  /gpt-4-vision/,
  /chatgpt-4o/,
  /gpt-5/,
  /(^|[^a-z0-9])o3(\b|-)/,
  /(^|[^a-z0-9])o4(\b|-)/,
  // Google — all Gemini chat models take images.
  /gemini/,
  // xAI — the vision-tagged Groks and Grok 4.
  /grok-4/,
  /grok-2-vision/,
  /grok-vision/,
  // Mistral — Pixtral plus the multimodal medium/small point releases.
  /pixtral/,
  /mistral-medium-3/,
  /mistral-small-3\.[12]/,
  // Meta Llama — 3.2 vision variants and the natively-multimodal Llama 4.
  /llama-3\.2-(11b|90b)/,
  /llama-3\.2-vision/,
  /llama-4/,
  // Qwen — the -VL line.
  /qwen[\d.]*-?vl/,
  // Amazon Nova multimodal tiers.
  /nova-(lite|pro|premier)/,
  // Misc multimodal: DeepSeek-VL, Phi vision/multimodal.
  /deepseek-vl/,
  /phi-.*vision/,
  /phi-4-multimodal/,
];

/**
 * True when `model` (a `provider/model` spec or bare model name) is known to
 * accept image input. Unknown / text-only models return `false`.
 */
export function supportsVision(model: string | null | undefined): boolean {
  if (!model) return false;
  const spec = model.toLowerCase().trim();
  if (spec === "") return false;
  return VISION_MODEL_PATTERNS.some((p) => p.test(spec));
}

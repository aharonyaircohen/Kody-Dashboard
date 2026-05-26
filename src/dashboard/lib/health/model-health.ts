/**
 * @fileType utility
 * @domain kody
 * @pattern health-probe-model
 * @ai-summary Probes whether the engine's configured model has a usable API
 *   key. A bad/missing provider key (e.g. MINIMAX_API_KEY) fails every run
 *   silently — the run starts, the agent can't reach the model, and it dies
 *   with no obvious cause. We read `agent.model` from kody.config.json, derive
 *   the provider, and confirm the matching key exists in the vault or env. We
 *   do NOT make a live model call (that would cost tokens on every poll).
 */
import { PROVIDER_PRESETS, type ProviderPreset } from "../variables/models";
import type { HealthSignal } from "./types";

/**
 * Resolve the API-key env/secret name for a `provider/model` spec.
 * Uses the built-in preset keyHint when known, else the conventional
 * `<PROVIDER>_API_KEY`. Pure — unit-tested.
 */
export function keyNameForModelSpec(modelSpec: string): {
  provider: string;
  keyName: string;
} | null {
  const spec = modelSpec.trim();
  if (!spec) return null;
  const provider = spec.split("/")[0]?.trim().toLowerCase();
  if (!provider) return null;
  const preset = (PROVIDER_PRESETS as Record<string, { keyHint?: string }>)[
    provider as ProviderPreset
  ];
  const keyName = preset?.keyHint ?? `${provider.toUpperCase()}_API_KEY`;
  return { provider, keyName };
}

/**
 * Build the model HealthSignal from resolved inputs. Pure — the route does
 * the I/O (config read + secret lookup) and hands the results here.
 */
export function buildModelSignal(input: {
  modelSpec: string | null | undefined;
  hasKey: boolean;
}): HealthSignal {
  const base: Pick<HealthSignal, "id" | "label"> = { id: "model", label: "Model provider" };
  if (!input.modelSpec) {
    return {
      ...base,
      level: "degraded",
      detail: "No engine model configured (agent.model unset) — runs fall back to a default.",
    };
  }
  const resolved = keyNameForModelSpec(input.modelSpec);
  if (!resolved) {
    return { ...base, level: "degraded", detail: `Model "${input.modelSpec}" is malformed.` };
  }
  if (!input.hasKey) {
    return {
      ...base,
      level: "down",
      detail: `Model is ${input.modelSpec} but ${resolved.keyName} is missing — every run will fail to reach the model.`,
    };
  }
  return {
    ...base,
    level: "ok",
    detail: `Model ${input.modelSpec} configured; ${resolved.keyName} present.`,
  };
}

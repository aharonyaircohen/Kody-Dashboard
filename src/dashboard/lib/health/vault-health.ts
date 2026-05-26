/**
 * @fileType utility
 * @domain kody
 * @pattern health-probe-vault
 * @ai-summary Probes the per-repo secrets vault. The webhook background path
 *   (inbox writes, notifications) bootstraps its GitHub token from the vault's
 *   GITHUB_TOKEN secret; if KODY_MASTER_KEY is unset or that secret is absent,
 *   those writes silently no-op (the empty-inbox failure mode). Pure builder +
 *   thin orchestration; the route supplies the resolved booleans.
 */
import type { HealthSignal } from "./types";

/**
 * Build the vault HealthSignal from resolved inputs. Pure — unit-tested.
 *  - master key unset      ⇒ degraded: vault disabled, falls back to env.
 *  - configured, no token  ⇒ degraded: webhook background writes will no-op.
 *  - configured + token    ⇒ ok.
 */
export function buildVaultSignal(input: {
  configured: boolean;
  hasGithubToken: boolean;
}): HealthSignal {
  const base: Pick<HealthSignal, "id" | "label"> = { id: "vault", label: "Secrets vault" };
  if (!input.configured) {
    return {
      ...base,
      level: "degraded",
      detail: "Vault not configured (KODY_MASTER_KEY unset) — secrets fall back to env vars.",
    };
  }
  if (!input.hasGithubToken) {
    return {
      ...base,
      level: "degraded",
      detail: "Vault has no GITHUB_TOKEN — webhook-driven inbox/notification writes will be skipped.",
    };
  }
  return { ...base, level: "ok", detail: "Vault configured with a GITHUB_TOKEN." };
}

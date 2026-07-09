/**
 * @fileType utility
 * @domain client-chat
 * @pattern default-brand-repo
 * @ai-summary Server-side default repo for `/client/*` brand lookups. Client
 *   visitors don't carry the dashboard's brand-repo cookie, so gated brand
 *   pages need a repo to read `brands/<slug>.json` from without one. Set
 *   `KODY_CLIENT_BRAND_REPO` to "owner/repo" (non-secret config knob, same
 *   family as KODY_CHAT_WORKFLOW_REPO).
 */
import type { ClientBrandRepoContext } from "./client-brand-repo-cookie";

export function defaultClientBrandRepoContext(): ClientBrandRepoContext | null {
  const raw = process.env.KODY_CLIENT_BRAND_REPO?.trim();
  if (!raw) return null;
  const [owner, repo] = raw.split("/").map((part) => part.trim());
  if (!owner || !repo) return null;
  return { owner, repo };
}

/**
 * @fileType utility
 * @domain vault
 * @pattern secret-resolver
 * @ai-summary High-level helper for runtime code that needs a secret. Reads
 *   the per-repo encrypted vault first, then falls back to process.env so
 *   migration is gradual and bootstrap (KODY_VAULT_KEY itself) still works.
 *
 *   Usage:
 *     const apiKey = await getSecret("GEMINI_API_KEY", { req })
 *
 *   When the request has no kody auth headers (no connected repo), the call
 *   falls through to process.env immediately. Keep that behavior — many CI
 *   paths hit endpoints without a repo header and still need env-based keys.
 */

import type { NextRequest } from "next/server"
import { getRequestAuth } from "@dashboard/lib/auth"
import { createUserOctokit } from "@dashboard/lib/github-client"
import { logger } from "@dashboard/lib/logger"
import { readVault } from "./store"
import { isVaultConfigured } from "./crypto"

interface GetSecretOptions {
  req: NextRequest
  /** When true, skip the process.env fallback. Default false. */
  vaultOnly?: boolean
}

export async function getSecret(
  name: string,
  options: GetSecretOptions,
): Promise<string | null> {
  if (isVaultConfigured()) {
    const auth = getRequestAuth(options.req)
    if (auth) {
      try {
        const octokit = createUserOctokit(auth.token)
        const { doc } = await readVault(octokit, auth.owner, auth.repo)
        const entry = doc.secrets[name]
        if (entry?.value) return entry.value
      } catch (err) {
        logger.warn(
          { err, name, owner: auth.owner, repo: auth.repo },
          "vault: read failed; falling back to env",
        )
      }
    }
  }

  if (options.vaultOnly) return null
  return process.env[name] ?? null
}

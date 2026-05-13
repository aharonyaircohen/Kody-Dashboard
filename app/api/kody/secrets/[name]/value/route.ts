/**
 * @fileType api-endpoint
 * @domain vault
 * @pattern secrets-api
 * @ai-summary GET /api/kody/secrets/[name]/value — return the decrypted
 *   value of a single secret to the authenticated user. Same auth gate
 *   as the rest of the vault API; values never go to anyone outside the
 *   active session. Used by the Settings page to populate masked inputs
 *   for project-scoped credentials (e.g. FLY_API_TOKEN).
 */

import { NextRequest, NextResponse } from "next/server"
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth"
import { readVault } from "@dashboard/lib/vault/store"
import { isVaultConfigured } from "@dashboard/lib/vault/crypto"
import { logger } from "@dashboard/lib/logger"

interface RouteContext {
  params: Promise<{ name: string }>
}

export async function GET(req: NextRequest, context: RouteContext) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError
  if (!isVaultConfigured()) {
    return NextResponse.json(
      { error: "vault_not_configured" },
      { status: 503 },
    )
  }

  const { name } = await context.params
  if (!name) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 })
  }

  const auth = getRequestAuth(req)
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 })
  }

  const octokit = await getUserOctokit(req)
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 })
  }

  try {
    const { doc } = await readVault(octokit, auth.owner, auth.repo)
    const entry = doc.secrets[name]
    if (!entry) {
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }
    return NextResponse.json({
      name,
      value: entry.value,
      updatedAt: entry.updatedAt,
      updatedBy: entry.updatedBy ?? null,
    })
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo, name },
      "vault: value read failed",
    )
    return NextResponse.json(
      { error: "vault_read_failed", message: (err as Error).message },
      { status: 500 },
    )
  }
}

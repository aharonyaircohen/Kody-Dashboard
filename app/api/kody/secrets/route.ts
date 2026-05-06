/**
 * @fileType api-endpoint
 * @domain vault
 * @pattern secrets-api
 * @ai-summary GET — list secret names + last-modified for the connected repo.
 *   POST — upsert a secret { name, value }. Values are never returned.
 */

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth"
import {
  invalidateVaultCache,
  listSecretMetadata,
  readVault,
  writeVault,
  type VaultDocument,
} from "@dashboard/lib/vault/store"
import { isVaultConfigured } from "@dashboard/lib/vault/crypto"
import { logger } from "@dashboard/lib/logger"

const NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/

const UpsertSchema = z.object({
  name: z.string().regex(NAME_RE, {
    message: "Name must be uppercase letters, digits, underscores; start with a letter; ≤128 chars.",
  }),
  value: z.string().min(1, { message: "Value cannot be empty" }).max(64 * 1024),
  actorLogin: z.string().optional(),
})

function vaultUnconfiguredResponse() {
  return NextResponse.json(
    {
      error: "vault_not_configured",
      message:
        "Vault unavailable: KODY_SESSION_SECRET is not set on the server.",
    },
    { status: 503 },
  )
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError
  if (!isVaultConfigured()) return vaultUnconfiguredResponse()

  const auth = getRequestAuth(req)
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 })
  }

  const octokit = await getUserOctokit(req)
  if (!octokit) return NextResponse.json({ error: "no_octokit" }, { status: 401 })

  try {
    const { doc } = await readVault(octokit, auth.owner, auth.repo)
    return NextResponse.json({ secrets: listSecretMetadata(doc) })
  } catch (err) {
    logger.error({ err, owner: auth.owner, repo: auth.repo }, "vault: list failed")
    return NextResponse.json(
      { error: "vault_read_failed", message: (err as Error).message },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError
  if (!isVaultConfigured()) return vaultUnconfiguredResponse()

  const auth = getRequestAuth(req)
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const parsed = UpsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    )
  }

  const verify = await verifyActorLogin(req, parsed.data.actorLogin)
  if ("status" in verify) return verify
  const actorLogin = verify.identity.login

  const octokit = await getUserOctokit(req)
  if (!octokit) return NextResponse.json({ error: "no_octokit" }, { status: 401 })

  try {
    const { doc, sha } = await readVault(octokit, auth.owner, auth.repo, { force: true })
    const next: VaultDocument = {
      ...doc,
      secrets: {
        ...doc.secrets,
        [parsed.data.name]: {
          value: parsed.data.value,
          updatedAt: new Date().toISOString(),
          updatedBy: actorLogin,
        },
      },
    }
    await writeVault(
      octokit,
      auth.owner,
      auth.repo,
      next,
      sha,
      `chore(vault): upsert ${parsed.data.name}`,
    )
    invalidateVaultCache(auth.owner, auth.repo)
    return NextResponse.json({ ok: true, secrets: listSecretMetadata(next) })
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo, name: parsed.data.name },
      "vault: upsert failed",
    )
    return NextResponse.json(
      { error: "vault_write_failed", message: (err as Error).message },
      { status: 500 },
    )
  }
}

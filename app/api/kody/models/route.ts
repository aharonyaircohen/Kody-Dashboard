/**
 * @fileType api-endpoint
 * @domain variables
 * @pattern models-api
 * @ai-summary GET — list chat models from the LLM_MODELS variable.
 *   PUT — replace the entire list with a validated ChatModel[] array.
 *   Backing storage is the LLM_MODELS entry in .kody/variables.json.
 *
 *   Why a dedicated route instead of /api/kody/variables: validation. The
 *   chat UI dropdown and the chat route both depend on the shape, so we
 *   parse with the Zod schema here and reject anything malformed before
 *   it lands on disk.
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
  invalidateVariablesCache,
  readVariables,
  writeVariables,
  type VariablesDocument,
} from "@dashboard/lib/variables/store"
import {
  ChatModelsSchema,
  VAR_LLM_MODELS,
} from "@dashboard/lib/variables/models"
import { logger } from "@dashboard/lib/logger"

const PutSchema = z.object({
  models: ChatModelsSchema,
  actorLogin: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  const auth = getRequestAuth(req)
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 })
  }

  const octokit = await getUserOctokit(req)
  if (!octokit) return NextResponse.json({ error: "no_octokit" }, { status: 401 })

  try {
    const { doc } = await readVariables(octokit, auth.owner, auth.repo)
    const raw = doc.variables[VAR_LLM_MODELS]?.value
    if (!raw) return NextResponse.json({ models: [] })
    try {
      const parsed = JSON.parse(raw)
      const result = ChatModelsSchema.safeParse(parsed)
      return NextResponse.json({ models: result.success ? result.data : [] })
    } catch {
      return NextResponse.json({ models: [] })
    }
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "models: list failed",
    )
    return NextResponse.json(
      { error: "models_read_failed", message: (err as Error).message },
      { status: 500 },
    )
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

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

  const parsed = PutSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    )
  }

  // At most one default model.
  const defaultCount = parsed.data.models.filter((m) => m.default).length
  if (defaultCount > 1) {
    return NextResponse.json(
      { error: "validation_error", message: "Only one model may be marked as default." },
      { status: 400 },
    )
  }

  const verify = await verifyActorLogin(req, parsed.data.actorLogin)
  if ("status" in verify) return verify
  const actorLogin = verify.identity.login

  const octokit = await getUserOctokit(req)
  if (!octokit) return NextResponse.json({ error: "no_octokit" }, { status: 401 })

  try {
    const { doc, sha } = await readVariables(octokit, auth.owner, auth.repo, {
      force: true,
    })
    const next: VariablesDocument = {
      ...doc,
      variables: {
        ...doc.variables,
        [VAR_LLM_MODELS]: {
          value: JSON.stringify(parsed.data.models),
          updatedAt: new Date().toISOString(),
          updatedBy: actorLogin,
        },
      },
    }
    await writeVariables(
      octokit,
      auth.owner,
      auth.repo,
      next,
      sha,
      `chore(variables): update chat models`,
    )
    invalidateVariablesCache(auth.owner, auth.repo)
    return NextResponse.json({ ok: true, models: parsed.data.models })
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "models: write failed",
    )
    return NextResponse.json(
      { error: "models_write_failed", message: (err as Error).message },
      { status: 500 },
    )
  }
}

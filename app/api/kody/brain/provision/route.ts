/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-provision
 *
 * POST /api/kody/brain/provision
 *
 * Provisions a per-user Brain-on-Fly app. Idempotent: a second call with
 * an existing app reuses the live machine and returns the same API key
 * — destroying first is required to rotate.
 *
 * Auth: requireKodyAuth (x-kody-token / owner / repo headers).
 * Reads FLY_API_TOKEN from the connected repo's secrets vault via
 * resolveFlyContext, the same path the one-shot runner uses.
 *
 * Returns { app, url, apiKey, machineId, region } on success. The
 * apiKey is returned exactly once — the Settings UI persists it as
 * auth.brain.apiKey alongside the URL.
 */

import { NextRequest, NextResponse } from 'next/server'

import { requireKodyAuth } from '@dashboard/lib/auth'
import { logger } from '@dashboard/lib/logger'
import { resolveFlyContext } from '@dashboard/lib/runners/fly-context'
import { provisionBrain } from '@dashboard/lib/runners/brain-fly'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  const ctx = await resolveFlyContext(req)
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  }
  if (!ctx.context.flyToken) {
    return NextResponse.json(
      {
        error:
          'Fly token missing — add FLY_API_TOKEN to the repo Secrets vault first.',
      },
      { status: 400 },
    )
  }

  try {
    const result = await provisionBrain({
      flyToken: ctx.context.flyToken,
      owner: ctx.context.owner,
      repo: `${ctx.context.owner}/${ctx.context.repo}`,
      githubToken: ctx.context.githubToken,
      allSecrets: ctx.context.allSecrets,
      perfTier: ctx.context.perfTier,
      litellmUrl: ctx.context.litellmUrl,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err, owner: ctx.context.owner }, 'brain provision failed')
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

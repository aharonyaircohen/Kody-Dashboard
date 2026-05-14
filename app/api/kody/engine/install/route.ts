/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern engine-install
 *
 * POST /api/kody/engine/install
 *
 * Drives the `/init` slash command in the chat UI: writes
 * `.github/workflows/kody.yml` into the connected repo and registers
 * the dashboard webhook. Deterministic — no LLM in the loop.
 *
 * Auth: `x-kody-token` + `x-kody-owner` + `x-kody-repo` headers (same
 * convention as the rest of the dashboard API).
 *
 * Body (optional): { force?: boolean } — re-commit even if the
 * workflow already matches the latest template.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth } from '@dashboard/lib/auth'
import { getPublicBaseUrl } from '@dashboard/lib/auth/oauth-url'
import { createUserOctokit } from '@dashboard/lib/github-client'
import { installEngine } from '@dashboard/lib/engine/install'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = getRequestAuth(req)
  if (!auth) {
    return NextResponse.json(
      {
        error: 'missing_auth',
        message:
          'Connect a repo first — /init needs x-kody-token, x-kody-owner, x-kody-repo headers.',
      },
      { status: 401 },
    )
  }

  let body: { force?: boolean } = {}
  try {
    if (req.headers.get('content-length') !== '0') {
      body = (await req.json().catch(() => ({}))) as typeof body
    }
  } catch {
    body = {}
  }

  const octokit = createUserOctokit(auth.token)
  const result = await installEngine({
    octokit,
    owner: auth.owner,
    repo: auth.repo,
    token: auth.token,
    hookUrl: `${getPublicBaseUrl(req)}/api/webhooks/github`,
    force: body.force === true,
  })

  if (!result.ok) {
    return NextResponse.json(result, { status: 500 })
  }
  return NextResponse.json(result, { status: 200 })
}

import { NextRequest, NextResponse } from 'next/server'
import { ZodError, type ZodSchema } from 'zod'

export interface ApiErrorResponse {
  error: string
  code?: string
  details?: Array<{ path: string; message: string }>
  retryAfter?: string
}

export const ApiErrors = {
  unauthorized: () =>
    NextResponse.json<ApiErrorResponse>({ error: 'Unauthorized' }, { status: 401 }),
  forbidden: (msg = 'Forbidden') =>
    NextResponse.json<ApiErrorResponse>({ error: msg }, { status: 403 }),
  notFound: (msg = 'Not found') =>
    NextResponse.json<ApiErrorResponse>({ error: msg }, { status: 404 }),
  badRequest: (msg = 'Bad request') =>
    NextResponse.json<ApiErrorResponse>({ error: msg }, { status: 400 }),
  internal: (msg = 'Internal server error') =>
    NextResponse.json<ApiErrorResponse>({ error: msg }, { status: 500 }),
  rateLimited: (retryAfter?: string) =>
    NextResponse.json<ApiErrorResponse>(
      { error: 'Rate limited', code: 'RATE_LIMITED', retryAfter },
      { status: 429 },
    ),
  upstreamError: (msg = 'Upstream error') =>
    NextResponse.json<ApiErrorResponse>({ error: msg, code: 'UPSTREAM_ERROR' }, { status: 502 }),
}

export function apiError(
  code: string,
  message: string,
  status: number,
): NextResponse<ApiErrorResponse> {
  return NextResponse.json<ApiErrorResponse>({ error: message, code }, { status })
}

export function apiValidationError(
  errors: ZodError | Array<{ path: string; message: string }>,
): NextResponse<ApiErrorResponse> {
  const details =
    errors instanceof ZodError
      ? errors.issues.map((e) => ({ path: e.path.join('.'), message: e.message }))
      : errors
  return NextResponse.json<ApiErrorResponse>(
    { error: 'Validation error', code: 'VALIDATION_ERROR', details },
    { status: 400 },
  )
}

export function parseQueryParams<T>(
  req: NextRequest,
  schema: ZodSchema<T>,
): { data: T } | { error: NextResponse } {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries())
  const result = schema.safeParse(params)
  if (!result.success) {
    return { error: apiValidationError(result.error) }
  }
  return { data: result.data }
}

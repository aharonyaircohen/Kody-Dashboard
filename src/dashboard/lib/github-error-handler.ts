import { ZodError, type ZodError as ZodErrorType } from 'zod'

import * as Sentry from '@sentry/nextjs'
import { ApiErrors, apiError, apiValidationError } from '@dashboard/lib/api-responses'
import type { ApiErrorResponse } from '@dashboard/lib/api-responses'
import type { NextResponse } from 'next/server'

// Octokit-style error interface
interface OctokitError {
  status?: number
  response?: {
    headers?: Record<string, string>
  }
  message?: string
}

/**
 * Determines if an error is a ZodError
 */
function isZodError(error: unknown): error is ZodErrorType {
  return error instanceof ZodError
}

/**
 * Determines if an error is an Octokit-style error with status
 */
function isOctokitError(error: unknown): error is OctokitError {
  if (typeof error !== 'object' || error === null) return false
  return 'status' in error
}

/**
 * Checks if error indicates rate limiting (either explicit 429 or 403 with rate limit headers)
 */
function isRateLimited(error: OctokitError): boolean {
  if (error.status === 429) return true

  // Check for rate limit headers on 403
  if (error.status === 403 && error.response?.headers) {
    const remaining = error.response.headers['x-ratelimit-remaining']
    return remaining === '0'
  }

  return false
}

/**
 * Gets the retry-after value from error headers if available
 */
function getRetryAfter(error: OctokitError): string | undefined {
  return error.response?.headers?.['retry-after']
}

/**
 * Handles GitHub/Octokit and other upstream errors, mapping them to consistent API responses.
 *
 * @param error - The caught error (typically unknown type)
 * @param routeName - The name of the route for logging purposes
 * @returns A NextResponse with a standardized error payload
 *
 * Error mappings:
 * - ZodError -> 400 VALIDATION_ERROR
 * - 401 -> 502 (upstream auth failure)
 * - 403 with rate limit -> 429 RATE_LIMITED
 * - 403 without rate limit -> 403 FORBIDDEN
 * - 404 -> 404 NOT_FOUND
 * - 429 -> 429 RATE_LIMITED
 * - 5xx -> 502 UPSTREAM_ERROR
 * - Unknown -> 500 INTERNAL_ERROR
 */
export function handleKodyApiError(
  error: unknown,
  routeName: string,
): NextResponse<ApiErrorResponse> {
  // Extract a safe message for logging (never log stack traces)
  const safeMessage = error instanceof Error ? error.message : 'Unknown error'

  // Capture exception to Sentry
  Sentry.captureException(error, { tags: { route: routeName } })

  // Handle Zod validation errors
  if (isZodError(error)) {
    console.error(`[Kody] ${routeName}: Validation error`)
    return apiValidationError(error)
  }

  // Handle Octokit/GitHub errors
  if (isOctokitError(error)) {
    const status = error.status

    // 401 - upstream authentication failure
    if (status === 401) {
      console.error(`[Kody] ${routeName}: GitHub authentication failed`)
      return apiError('UNAUTHORIZED', 'GitHub authentication failed', 502)
    }

    // 403 - check for rate limiting
    if (status === 403) {
      if (isRateLimited(error)) {
        const retryAfter = getRetryAfter(error)
        console.error(`[Kody] ${routeName}: GitHub rate limited`)
        return ApiErrors.rateLimited(retryAfter)
      }
      console.error(`[Kody] ${routeName}: GitHub access denied`)
      return ApiErrors.forbidden('GitHub access denied')
    }

    // 404 - resource not found
    if (status === 404) {
      console.error(`[Kody] ${routeName}: Resource not found`)
      return ApiErrors.notFound('Resource')
    }

    // 429 - rate limited
    if (status === 429) {
      const retryAfter = getRetryAfter(error)
      console.error(`[Kody] ${routeName}: GitHub rate limited (429)`)
      return ApiErrors.rateLimited(retryAfter)
    }

    // 5xx - upstream errors
    if (status !== undefined && status >= 500) {
      console.error(`[Kody] ${routeName}: GitHub service error (${status})`)
      return ApiErrors.upstreamError('GitHub service error')
    }
  }

  // Unknown error - log safely and return internal error
  console.error(`[Kody] ${routeName}: ${safeMessage}`)
  return ApiErrors.internal()
}

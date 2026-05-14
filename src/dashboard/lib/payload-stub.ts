// Payload CMS dependency removed in standalone Kody.
// Dashboard uses per-request PAT auth (x-kody-token header); see src/dashboard/lib/auth.ts.

export function getPayload(): never {
  throw new Error(
    'Payload CMS is not available in standalone Kody. Use per-request PAT auth via x-kody-token headers.',
  )
}

export default getPayload

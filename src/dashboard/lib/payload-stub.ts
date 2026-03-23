// Payload CMS dependency removed in standalone Kody
// Dashboard uses GitHub OAuth exclusively (kody_session.ts)

export function getPayload(): never {
  throw new Error(
    'Payload CMS is not available in standalone Kody. Use GitHub OAuth via kody_session.',
  )
}

export default getPayload

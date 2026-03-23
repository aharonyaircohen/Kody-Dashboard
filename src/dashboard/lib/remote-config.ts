/**
 * @fileType utility
 * @domain kody
 * @pattern config
 * @ai-summary Parses REMOTE_DEV_USERS env var to enable per-user remote dev agent access
 *
 * Format: REMOTE_DEV_USERS=gh_username:secret_key:https://funnel-url
 * Multiple users: comma-separated
 *
 * When REMOTE_DEV_USERS is not set, all exports return empty/false values —
 * the feature is completely invisible to users without a configured key.
 */

export interface RemoteUserConfig {
  /** GitHub username */
  ghUsername: string
  /** Bearer key for the remote agent */
  key: string
  /** Tailscale Funnel URL (https://) */
  funnelUrl: string
}

/**
 * Parse the REMOTE_DEV_USERS environment variable.
 * Returns an empty array if the env var is not set or malformed.
 */
function parseRemoteDevUsers(raw?: string): RemoteUserConfig[] {
  if (!raw || !raw.trim()) return []

  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const configs: RemoteUserConfig[] = []

  for (const entry of entries) {
    // Format: gh_username:secret_key:https://funnel-url
    // The URL may contain colons (https://...), so split on first two colons only
    const firstColon = entry.indexOf(':')
    if (firstColon === -1) continue

    const secondColon = entry.indexOf(':', firstColon + 1)
    if (secondColon === -1) continue

    const ghUsername = entry.slice(0, firstColon).trim()
    const key = entry.slice(firstColon + 1, secondColon).trim()
    const funnelUrl = entry.slice(secondColon + 1).trim()

    if (!ghUsername || !key || !funnelUrl) continue
    if (!funnelUrl.startsWith('https://') && !funnelUrl.startsWith('http://')) continue

    configs.push({ ghUsername, key, funnelUrl })
  }

  return configs
}

// Parse once at module load time
const remoteUsers: Map<string, RemoteUserConfig> = new Map(
  parseRemoteDevUsers(process.env.REMOTE_DEV_USERS).map((c) => [c.ghUsername.toLowerCase(), c]),
)

/**
 * Get the remote config for a specific GitHub user.
 * Returns undefined if the user is not configured.
 */
export function getRemoteConfig(ghUsername: string): RemoteUserConfig | undefined {
  if (!ghUsername) return undefined
  return remoteUsers.get(ghUsername.toLowerCase())
}

/**
 * Returns true if the given GitHub user has a remote dev environment configured.
 */
export function isRemoteEnabled(ghUsername: string): boolean {
  return !!getRemoteConfig(ghUsername)
}

/**
 * Returns all configured remote users (for admin/debug purposes).
 * Keys are omitted for security.
 */
export function getAllRemoteUsers(): Array<{ ghUsername: string; funnelUrl: string }> {
  return Array.from(remoteUsers.values()).map(({ ghUsername, funnelUrl }) => ({
    ghUsername,
    funnelUrl,
  }))
}

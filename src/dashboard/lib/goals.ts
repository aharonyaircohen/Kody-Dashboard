/**
 * @fileType utility
 * @domain kody
 * @pattern goals-manifest
 * @ai-summary Goals are groupings of tasks. They live in a single "manifest"
 *   GitHub issue labelled `kody:goals-manifest` whose body carries a JSON block
 *   between HTML comment markers. Tasks get linked to goals via labels like
 *   `goal:<slug>`.
 */

export const GOALS_MANIFEST_LABEL = 'kody:goals-manifest'
export const GOAL_LABEL_PREFIX = 'goal:'

export const MANIFEST_START = '<!-- kody-goals-start -->'
export const MANIFEST_END = '<!-- kody-goals-end -->'
export const MANIFEST_ISSUE_TITLE = 'Kody Goals Manifest'

export interface Goal {
  id: string
  name: string
  description?: string
  dueDate?: string
  createdAt: string
  updatedAt?: string
}

export interface GoalsManifest {
  version: 1
  goals: Goal[]
}

export const EMPTY_MANIFEST: GoalsManifest = { version: 1, goals: [] }

export function goalLabel(id: string): string {
  return `${GOAL_LABEL_PREFIX}${id}`
}

export function parseManifestBody(body: string | null | undefined): GoalsManifest {
  if (!body) return { version: 1, goals: [] }
  const start = body.indexOf(MANIFEST_START)
  const end = body.indexOf(MANIFEST_END)
  if (start === -1 || end === -1 || end < start) return { version: 1, goals: [] }

  const inner = body.slice(start + MANIFEST_START.length, end)
  const fenceOpen = inner.indexOf('```')
  const fenceClose = inner.lastIndexOf('```')
  if (fenceOpen === -1 || fenceClose === -1 || fenceClose === fenceOpen) {
    return { version: 1, goals: [] }
  }
  const afterOpenNewline = inner.indexOf('\n', fenceOpen)
  if (afterOpenNewline === -1) return { version: 1, goals: [] }
  const json = inner.slice(afterOpenNewline + 1, fenceClose).trim()
  if (!json) return { version: 1, goals: [] }

  try {
    const parsed = JSON.parse(json) as Partial<GoalsManifest>
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.goals)) {
      return { version: 1, goals: [] }
    }
    const goals: Goal[] = parsed.goals
      .filter((g): g is Goal =>
        !!g &&
        typeof g === 'object' &&
        typeof (g as Goal).id === 'string' &&
        typeof (g as Goal).name === 'string',
      )
      .map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        dueDate: g.dueDate,
        createdAt: g.createdAt ?? new Date().toISOString(),
        updatedAt: g.updatedAt,
      }))
    return { version: 1, goals }
  } catch {
    return { version: 1, goals: [] }
  }
}

export function serializeManifestBody(manifest: GoalsManifest): string {
  const preamble =
    '> Kody goals manifest — the dashboard reads and writes the JSON block below.\n> Prefer editing via the UI to avoid merge conflicts.\n\n'
  const json = JSON.stringify(manifest, null, 2)
  return `${preamble}${MANIFEST_START}\n\n\`\`\`json\n${json}\n\`\`\`\n\n${MANIFEST_END}\n`
}

export function slugifyGoalName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'goal'
}

export function uniqueGoalId(base: string, existing: Goal[]): string {
  const taken = new Set(existing.map((g) => g.id))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

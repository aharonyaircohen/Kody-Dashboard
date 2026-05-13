/**
 * @fileType utility
 * @domain changelog
 * @pattern webhook-side-effect
 * @ai-summary Webhook side-effects for CHANGELOG.md maintenance. Called
 *   fire-and-forget from the GitHub webhook receiver. Errors are logged
 *   but never thrown — a failed CHANGELOG write must not cause GitHub
 *   to retry the delivery.
 */

import { logger } from "@dashboard/lib/logger"
import {
  appendUnreleasedEntry,
  promoteUnreleased,
  type ChangelogEntry,
} from "./format"
import { getServerOctokit, updateChangelog } from "./file"

interface PRWebhookPayload {
  action?: string
  pull_request?: {
    number?: number
    title?: string
    html_url?: string
    merged?: boolean
    user?: { login?: string }
  }
  repository?: {
    name?: string
    owner?: { login?: string }
  }
}

interface ReleaseWebhookPayload {
  action?: string
  release?: {
    tag_name?: string
    name?: string
    published_at?: string
    draft?: boolean
    prerelease?: boolean
  }
  repository?: {
    name?: string
    owner?: { login?: string }
  }
}

/** Stripped, validated repo coordinates or null if payload is malformed. */
function readRepo(payload: {
  repository?: { name?: string; owner?: { login?: string } }
}): { owner: string; repo: string } | null {
  const owner = payload.repository?.owner?.login
  const repo = payload.repository?.name
  if (!owner || !repo) return null
  return { owner, repo }
}

/**
 * On `pull_request.closed && merged === true`, append a bullet under
 * `## [Unreleased]` in CHANGELOG.md. Idempotent on PR number.
 */
export async function handlePrMerged(
  payload: PRWebhookPayload,
): Promise<void> {
  if (payload.action !== "closed") return
  const pr = payload.pull_request
  if (!pr?.merged) return

  const number = pr.number
  const title = pr.title
  const url = pr.html_url
  const author = pr.user?.login
  if (
    typeof number !== "number" ||
    typeof title !== "string" ||
    typeof url !== "string" ||
    typeof author !== "string"
  ) {
    logger.warn(
      { event: "changelog_skip_incomplete_pr", number },
      "Skipping changelog append — incomplete PR payload",
    )
    return
  }

  const repoCoords = readRepo(payload)
  if (!repoCoords) return

  const entry: ChangelogEntry = {
    prNumber: number,
    prUrl: url,
    title,
    author,
  }

  try {
    const octokit = getServerOctokit()
    const result = await updateChangelog(
      octokit,
      repoCoords.owner,
      repoCoords.repo,
      `chore(changelog): add #${number}`,
      (current) => appendUnreleasedEntry(current, entry),
    )
    logger.info(
      {
        event: "changelog_appended",
        pr: number,
        written: result.written,
      },
      result.written
        ? "CHANGELOG: appended unreleased entry"
        : "CHANGELOG: skipped (already present)",
    )
  } catch (err) {
    logger.error(
      {
        event: "changelog_append_failed",
        pr: number,
        error: err instanceof Error ? err.message : String(err),
      },
      "Failed to append PR to CHANGELOG.md",
    )
  }
}

/**
 * On `release.published`, promote `## [Unreleased]` to a versioned section.
 * Skips draft and prerelease events. No-op if Unreleased has no entries.
 */
export async function handleReleasePublished(
  payload: ReleaseWebhookPayload,
): Promise<void> {
  if (payload.action !== "published") return
  const release = payload.release
  if (!release || release.draft || release.prerelease) return

  const version = (release.tag_name ?? release.name ?? "").trim()
  const publishedAt = release.published_at ?? new Date().toISOString()
  if (!version) {
    logger.warn(
      { event: "changelog_skip_empty_version" },
      "Skipping promote — release has no tag_name/name",
    )
    return
  }

  const repoCoords = readRepo(payload)
  if (!repoCoords) return

  try {
    const octokit = getServerOctokit()
    const result = await updateChangelog(
      octokit,
      repoCoords.owner,
      repoCoords.repo,
      `chore(changelog): release ${version}`,
      (current) => promoteUnreleased(current, version, publishedAt),
    )
    logger.info(
      {
        event: "changelog_promoted",
        version,
        written: result.written,
      },
      result.written
        ? `CHANGELOG: promoted Unreleased → ${version}`
        : "CHANGELOG: skipped promote (no-op)",
    )
  } catch (err) {
    logger.error(
      {
        event: "changelog_promote_failed",
        version,
        error: err instanceof Error ? err.message : String(err),
      },
      "Failed to promote Unreleased section in CHANGELOG.md",
    )
  }
}

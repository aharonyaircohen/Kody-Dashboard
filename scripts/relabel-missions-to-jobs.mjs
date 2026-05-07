#!/usr/bin/env node
// One-time migration: rename `kody:mission` → `kody:job` on every issue in the
// connected repo. Idempotent — safe to re-run.
//
// Usage:
//   GITHUB_TOKEN=ghp_xxx GITHUB_REPO=owner/name node scripts/relabel-missions-to-jobs.mjs
//
// Token needs `repo` scope (write access to issues + labels).

import { Octokit } from '@octokit/rest'

const token = process.env.GITHUB_TOKEN
const repoSlug = process.env.GITHUB_REPO
if (!token) {
  console.error('GITHUB_TOKEN is required')
  process.exit(1)
}
if (!repoSlug || !repoSlug.includes('/')) {
  console.error('GITHUB_REPO is required (format: owner/name)')
  process.exit(1)
}

const [owner, repo] = repoSlug.split('/')
const octokit = new Octokit({ auth: token })

const OLD_LABEL = 'kody:mission'
const NEW_LABEL = 'kody:job'

async function ensureNewLabel() {
  try {
    await octokit.issues.getLabel({ owner, repo, name: NEW_LABEL })
    console.log(`label "${NEW_LABEL}" already exists`)
  } catch (e) {
    if (e.status !== 404) throw e
    // Try to mirror the old label's color/description for continuity
    let color = 'cccccc'
    let description = ''
    try {
      const old = await octokit.issues.getLabel({ owner, repo, name: OLD_LABEL })
      color = old.data.color || color
      description = old.data.description || description
    } catch (_) {}
    await octokit.issues.createLabel({ owner, repo, name: NEW_LABEL, color, description })
    console.log(`created label "${NEW_LABEL}"`)
  }
}

async function relabelIssues() {
  let migrated = 0
  for await (const { data: issues } of octokit.paginate.iterator(
    octokit.issues.listForRepo,
    { owner, repo, labels: OLD_LABEL, state: 'all', per_page: 100 },
  )) {
    for (const issue of issues) {
      if (issue.pull_request) continue
      const labels = issue.labels
        .map((l) => (typeof l === 'string' ? l : l.name))
        .filter(Boolean)
      const next = Array.from(new Set(labels.filter((n) => n !== OLD_LABEL).concat(NEW_LABEL)))
      await octokit.issues.setLabels({ owner, repo, issue_number: issue.number, labels: next })
      console.log(`#${issue.number}: relabeled (${issue.title})`)
      migrated += 1
    }
  }
  console.log(`relabeled ${migrated} issue(s)`)
}

async function deleteOldLabel() {
  try {
    await octokit.issues.deleteLabel({ owner, repo, name: OLD_LABEL })
    console.log(`deleted label "${OLD_LABEL}"`)
  } catch (e) {
    if (e.status !== 404) throw e
    console.log(`label "${OLD_LABEL}" not present (skipped)`)
  }
}

await ensureNewLabel()
await relabelIssues()
await deleteOldLabel()
console.log('done.')

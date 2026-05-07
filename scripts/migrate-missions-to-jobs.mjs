#!/usr/bin/env node
// One-time migration: move every `.kody/missions/<slug>.md` to
// `.kody/jobs/<slug>.md` in the connected repo. Idempotent — safe to re-run.
//
// Usage:
//   GITHUB_TOKEN=ghp_xxx GITHUB_REPO=owner/name node scripts/migrate-missions-to-jobs.mjs
//
// Token needs `repo` scope (write access to repo contents).

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

const OLD_DIR = '.kody/missions'
const NEW_DIR = '.kody/jobs'

async function listLegacyFiles() {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: OLD_DIR })
    if (!Array.isArray(data)) return []
    return data.filter((e) => e.type === 'file' && e.name.endsWith('.md'))
  } catch (e) {
    if (e.status === 404) return []
    throw e
  }
}

async function newPathExists(path) {
  try {
    await octokit.repos.getContent({ owner, repo, path })
    return true
  } catch (e) {
    if (e.status === 404) return false
    throw e
  }
}

async function fetchFile(path) {
  const { data } = await octokit.repos.getContent({ owner, repo, path })
  if (Array.isArray(data) || !('content' in data)) {
    throw new Error(`Unexpected response for ${path}`)
  }
  return data
}

async function migrateFile(file) {
  const oldPath = `${OLD_DIR}/${file.name}`
  const newPath = `${NEW_DIR}/${file.name}`

  if (await newPathExists(newPath)) {
    console.log(`skip ${file.name}: already exists at ${newPath}`)
    const old = await fetchFile(oldPath)
    await octokit.repos.deleteFile({
      owner,
      repo,
      path: oldPath,
      message: `chore(jobs): remove legacy ${oldPath}`,
      sha: old.sha,
    })
    console.log(`  deleted legacy ${oldPath}`)
    return
  }

  const old = await fetchFile(oldPath)
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: newPath,
    message: `chore(jobs): migrate ${file.name} to ${NEW_DIR}`,
    content: old.content.replace(/\n/g, ''),
  })
  console.log(`copied ${oldPath} → ${newPath}`)

  await octokit.repos.deleteFile({
    owner,
    repo,
    path: oldPath,
    message: `chore(jobs): remove legacy ${oldPath}`,
    sha: old.sha,
  })
  console.log(`  deleted ${oldPath}`)
}

const files = await listLegacyFiles()
if (files.length === 0) {
  console.log(`nothing to migrate — ${OLD_DIR}/ is empty or missing.`)
  process.exit(0)
}

console.log(`migrating ${files.length} file(s) from ${OLD_DIR}/ to ${NEW_DIR}/`)
for (const file of files) {
  try {
    await migrateFile(file)
  } catch (e) {
    console.error(`failed on ${file.name}:`, e.message)
  }
}
console.log('done.')

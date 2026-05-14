import { describe, expect, it } from 'vitest'
import {
  isKodyMarkerCommit,
  isKodyOwnedBranch,
} from '@dashboard/lib/branches/domain/branch-ownership'

describe('isKodyMarkerCommit', () => {
  it('matches the exact canonical marker for the issue', () => {
    expect(isKodyMarkerCommit('vibe: start session for #123', 123)).toBe(true)
  })

  it('matches case-insensitively (commit messages can be edited)', () => {
    expect(isKodyMarkerCommit('VIBE: Start Session For #123', 123)).toBe(true)
  })

  it('matches with or without the # prefix on the issue number', () => {
    expect(isKodyMarkerCommit('vibe: start session for 123', 123)).toBe(true)
    expect(isKodyMarkerCommit('vibe: start session for #123', 123)).toBe(true)
  })

  it('rejects markers for a different issue', () => {
    expect(isKodyMarkerCommit('vibe: start session for #456', 123)).toBe(false)
  })

  it('rejects non-marker commits with similar wording', () => {
    expect(isKodyMarkerCommit('fix: start session', 123)).toBe(false)
    expect(isKodyMarkerCommit('chore: vibe stuff', 123)).toBe(false)
  })

  it('rejects empty / random strings', () => {
    expect(isKodyMarkerCommit('', 123)).toBe(false)
    expect(isKodyMarkerCommit('Merge branch dev into 123-foo', 123)).toBe(false)
  })
})

describe('isKodyOwnedBranch', () => {
  it('returns true when ANY commit on the branch matches the marker', () => {
    const messages = [
      'fix: button color',
      'vibe: start session for #123',
      'refactor: extract helper',
    ]
    expect(isKodyOwnedBranch(messages, 123)).toBe(true)
  })

  it('returns true when the marker is the only commit', () => {
    expect(isKodyOwnedBranch(['vibe: start session for #123'], 123)).toBe(true)
  })

  it('returns false when no commit matches the marker for this issue', () => {
    expect(
      isKodyOwnedBranch(['fix: something', 'chore: bump deps'], 123),
    ).toBe(false)
  })

  it('returns false when the marker is for a different issue', () => {
    // Slug collision case: branch "123-foo" pre-existed for issue #456
    expect(
      isKodyOwnedBranch(['vibe: start session for #456'], 123),
    ).toBe(false)
  })

  it('returns false for an empty list', () => {
    expect(isKodyOwnedBranch([], 123)).toBe(false)
  })
})

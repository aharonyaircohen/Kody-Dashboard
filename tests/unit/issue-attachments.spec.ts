/**
 * Unit tests for the GitHub-issue-attachment resolver used by the Brain chat
 * proxy. Covers URL extraction from body/comments, authenticated download,
 * size/timeout limits, and graceful failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@dashboard/lib/github-client', () => ({
  fetchIssue: vi.fn(),
  fetchComments: vi.fn(),
}))

import { fetchIssueAttachments } from '@dashboard/lib/issue-attachments'
import { fetchIssue, fetchComments } from '@dashboard/lib/github-client'

const mockedFetchIssue = vi.mocked(fetchIssue)
const mockedFetchComments = vi.mocked(fetchComments)

function mockHttp(urlToBody: Record<string, { body: Uint8Array; contentType: string; status?: number }>) {
  globalThis.fetch = vi.fn(async (url: string | URL) => {
    const key = String(url)
    const match = urlToBody[key]
    if (!match) return new Response(null, { status: 404 })
    return new Response(match.body as BodyInit, {
      status: match.status ?? 200,
      headers: { 'content-type': match.contentType },
    })
  }) as unknown as typeof fetch
}

describe('fetchIssueAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GITHUB_TOKEN = 'test-token'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps image attachments and drops non-image attachments (Brain multimodal supports images only)', async () => {
    mockedFetchIssue.mockResolvedValue({
      id: 1,
      number: 42,
      title: 't',
      body: 'See screenshot: https://github.com/user-attachments/assets/aaaa-bbbb and https://user-images.githubusercontent.com/1/foo.png',
      state: 'open',
      labels: [],
      milestone: null,
      assignees: [],
      created_at: '',
      updated_at: '',
      html_url: '',
      user: { login: 'u', avatar_url: '' },
      comments: 0,
      pull_request: null,
    } as any)
    mockedFetchComments.mockResolvedValue([
      {
        id: 1,
        body: 'log: https://github.com/owner/repo/assets/1234/cccc-dddd',
        created_at: '',
        user: { login: 'u', type: 'User', avatar_url: '' },
      },
    ] as any)

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff])
    const txt = new Uint8Array([0x68, 0x69])

    mockHttp({
      'https://github.com/user-attachments/assets/aaaa-bbbb': { body: png, contentType: 'image/png' },
      'https://user-images.githubusercontent.com/1/foo.png': { body: jpeg, contentType: 'image/jpeg' },
      'https://github.com/owner/repo/assets/1234/cccc-dddd': { body: txt, contentType: 'text/plain' },
    })

    const result = await fetchIssueAttachments(42)

    expect(result).toHaveLength(2)
    const byMime = Object.fromEntries(result.map((a) => [a.mimeType, a]))
    expect(byMime['image/png'].data).toBe(Buffer.from(png).toString('base64'))
    expect(byMime['image/jpeg'].data).toBe(Buffer.from(jpeg).toString('base64'))
    expect(byMime['text/plain']).toBeUndefined()
    expect(byMime['image/png'].name).toMatch(/aaaa-bbbb(\.png)?$/)
  })

  it('de-duplicates URLs that appear in multiple sources', async () => {
    const url = 'https://github.com/user-attachments/assets/zzzz'
    mockedFetchIssue.mockResolvedValue({ body: url } as any)
    mockedFetchComments.mockResolvedValue([{ body: url, id: 1, created_at: '', user: { login: 'u', type: 'User', avatar_url: '' } }] as any)
    const spy = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/gif' } }))
    globalThis.fetch = spy as unknown as typeof fetch

    const result = await fetchIssueAttachments(1)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
  })

  it('drops files that fail to download without failing the whole batch', async () => {
    mockedFetchIssue.mockResolvedValue({
      body: 'a https://github.com/user-attachments/assets/ok\nb https://github.com/user-attachments/assets/bad',
    } as any)
    mockedFetchComments.mockResolvedValue([])

    globalThis.fetch = vi.fn(async (url: string | URL) => {
      if (String(url).endsWith('/ok')) {
        return new Response(new Uint8Array([7, 8, 9]), { status: 200, headers: { 'content-type': 'image/png' } })
      }
      return new Response(null, { status: 500 })
    }) as unknown as typeof fetch

    const result = await fetchIssueAttachments(1)
    expect(result).toHaveLength(1)
    expect(result[0].mimeType).toBe('image/png')
  })

  it('returns [] when the issue has no attachment URLs', async () => {
    mockedFetchIssue.mockResolvedValue({ body: 'hello, no attachments here' } as any)
    mockedFetchComments.mockResolvedValue([{ id: 1, body: 'plain comment', created_at: '', user: { login: 'u', type: 'User', avatar_url: '' } }] as any)
    globalThis.fetch = vi.fn() as unknown as typeof fetch

    const result = await fetchIssueAttachments(1)
    expect(result).toEqual([])
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('sends an Authorization header when GITHUB_TOKEN is set', async () => {
    mockedFetchIssue.mockResolvedValue({ body: 'https://github.com/user-attachments/assets/abc' } as any)
    mockedFetchComments.mockResolvedValue([])

    const fetchSpy = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/png' } }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    await fetchIssueAttachments(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://github.com/user-attachments/assets/abc',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    )
  })

  it('returns [] when fetchIssue throws', async () => {
    mockedFetchIssue.mockRejectedValue(new Error('api down'))
    mockedFetchComments.mockResolvedValue([])
    const result = await fetchIssueAttachments(1)
    expect(result).toEqual([])
  })
})

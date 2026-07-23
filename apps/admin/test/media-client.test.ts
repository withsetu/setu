import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchMediaIndex,
  deleteMedia,
  MediaTransportError
} from '../src/media/media-client'

afterEach(() => vi.restoreAllMocks())

describe('media-client', () => {
  it('fetchMediaIndex returns records', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ records: [{ mediaKey: 'a' }] }), {
            status: 200
          })
      )
    )
    expect(await fetchMediaIndex('http://x')).toEqual([{ mediaKey: 'a' }])
  })
  it('deleteMedia DELETEs the mediaKey and throws on failure', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    await deleteMedia('http://x', '2026/06/cat')
    expect(f).toHaveBeenCalledWith('http://x/media/2026/06/cat', {
      method: 'DELETE',
      credentials: 'include'
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"no"}', { status: 500 }))
    )
    await expect(deleteMedia('http://x', 'k')).rejects.toThrow()
  })

  // #870: the call site has to tell "the request never reached the server" (curate it —
  // the raw text is fetch's "Failed to fetch") apart from "the server answered and said
  // why" (show that verbatim — e.g. a 409 "media is in use"). Both used to arrive as a
  // bare Error, so the only safe call-site behaviour was echoing the raw string.
  it('deleteMedia throws MediaTransportError when the request never reaches the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    )
    await expect(deleteMedia('http://x', 'k')).rejects.toBeInstanceOf(
      MediaTransportError
    )
  })

  it('deleteMedia throws a plain Error carrying the server message on a response error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"error":"media is in use"}', { status: 409 })
      )
    )
    const err = await deleteMedia('http://x', 'k').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(MediaTransportError)
    expect((err as Error).message).toBe('media is in use')
  })

  it('fetchMediaIndex throws MediaTransportError when the request never reaches the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    )
    await expect(fetchMediaIndex('http://x')).rejects.toBeInstanceOf(
      MediaTransportError
    )
  })
})

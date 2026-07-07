import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchMediaIndex, deleteMedia } from '../src/media/media-client'

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
})

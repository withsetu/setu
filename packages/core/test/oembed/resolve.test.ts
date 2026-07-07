import { describe, it, expect, vi } from 'vitest'
import { resolveOembed } from '../../src/oembed/resolve'

const YT = {
  type: 'video',
  title: 'Never Gonna Give You Up',
  author_name: 'Rick Astley',
  provider_name: 'YouTube',
  thumbnail_url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
  thumbnail_width: 480,
  thumbnail_height: 360,
  html: '<iframe src="https://www.youtube.com/embed/abc"></iframe>',
  width: 480,
  height: 270
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status
  })

describe('resolveOembed', () => {
  it('returns unsupported for a non-allowlisted URL — and never fetches', async () => {
    const fetchImpl = vi.fn()
    const r = await resolveOembed('https://random-site.example/x', {
      fetchImpl
    })
    expect(r).toEqual({ ok: false, reason: 'unsupported' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fetches the FIXED provider endpoint, never the user host', async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(jsonRes(YT))
    )
    await resolveOembed('https://youtu.be/abc', { fetchImpl })
    const called = new URL(fetchImpl.mock.calls[0]![0] as string)
    expect(called.host).toBe('www.youtube.com')
    expect(called.searchParams.get('url')).toBe('https://youtu.be/abc')
  })

  it('normalizes a successful video oEmbed response', async () => {
    const fetchImpl = vi.fn(async () => jsonRes(YT))
    const r = await resolveOembed('https://youtu.be/abc', { fetchImpl })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).toMatchObject({
      provider: 'youtube',
      mediaType: 'video',
      oembedType: 'video',
      title: 'Never Gonna Give You Up',
      authorName: 'Rick Astley',
      thumbnailUrl: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
      width: 480,
      height: 270,
      sourceUrl: 'https://youtu.be/abc'
    })
    expect(r.data.html).toContain('<iframe')
  })

  it('uses the photo `url` as the thumbnail when no thumbnail_url is given', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({
        type: 'photo',
        title: 'Pic',
        url: 'https://live.staticflickr.com/x.jpg',
        width: 1024,
        height: 768
      })
    )
    const r = await resolveOembed('https://flickr.com/photos/a/1', {
      fetchImpl
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.thumbnailUrl).toBe('https://live.staticflickr.com/x.jpg')
    expect(r.data.mediaType).toBe('photo')
  })

  it('maps a thrown fetch to fetch_failed', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    })
    expect(await resolveOembed('https://youtu.be/abc', { fetchImpl })).toEqual({
      ok: false,
      reason: 'fetch_failed'
    })
  })

  it('maps a non-2xx response to fetch_failed', async () => {
    const fetchImpl = vi.fn(async () => jsonRes('nope', 404))
    expect(await resolveOembed('https://youtu.be/abc', { fetchImpl })).toEqual({
      ok: false,
      reason: 'fetch_failed'
    })
  })

  it('maps invalid JSON to invalid_response', async () => {
    const fetchImpl = vi.fn(async () => jsonRes('<html>not json</html>'))
    expect(await resolveOembed('https://youtu.be/abc', { fetchImpl })).toEqual({
      ok: false,
      reason: 'invalid_response'
    })
  })

  it('rejects a response with no oEmbed `type`', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ title: 'no type here' }))
    expect(await resolveOembed('https://youtu.be/abc', { fetchImpl })).toEqual({
      ok: false,
      reason: 'invalid_response'
    })
  })

  it('rejects a video/rich response whose html exceeds the size cap (defensive)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({
        type: 'video',
        title: 'big',
        html: '<i>' + 'x'.repeat(40000) + '</i>'
      })
    )
    expect(await resolveOembed('https://youtu.be/abc', { fetchImpl })).toEqual({
      ok: false,
      reason: 'invalid_response'
    })
  })
})

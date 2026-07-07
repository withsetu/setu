import { describe, it, expect, vi } from 'vitest'
import { createOembedApi } from '../src/oembed'
import type { ResolveActor } from '../src/auth/resolve-actor'

const owner: ResolveActor = () => ({ id: 'o', role: 'owner' })
const viewer: ResolveActor = () => ({ id: 'v', role: 'viewer' })
const anon: ResolveActor = () => null

const YT = {
  type: 'video',
  title: 'Rick',
  thumbnail_url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
  html: '<iframe src="https://www.youtube.com/embed/abc"></iframe>',
  width: 480,
  height: 270
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status
  })

const post = (app: ReturnType<typeof createOembedApi>, body: unknown) =>
  app.fetch(
    new Request('http://x/api/oembed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  )

describe('createOembedApi — POST /api/oembed', () => {
  it('401s an unauthenticated request', async () => {
    const app = createOembedApi({ resolveActor: anon })
    expect((await post(app, { url: 'https://youtu.be/abc' })).status).toBe(401)
  })

  it('403s an authenticated actor without content.create (viewer) — the wrong actor is blocked', async () => {
    const fetchImpl = vi.fn()
    const app = createOembedApi({ resolveActor: viewer, fetchImpl })
    expect((await post(app, { url: 'https://youtu.be/abc' })).status).toBe(403)
    expect(fetchImpl).not.toHaveBeenCalled() // gate short-circuits before any resolve
  })

  it('200s with normalized data for an author-role actor (the right actor is admitted)', async () => {
    const fetchImpl = vi.fn(async () => jsonRes(YT))
    const app = createOembedApi({
      resolveActor: () => ({ id: 'a', role: 'author' }),
      fetchImpl
    })
    const res = await post(app, { url: 'https://youtu.be/abc' })
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      data: { provider: string; mediaType: string; thumbnailUrl: string }
    }
    expect(json.data).toMatchObject({ provider: 'youtube', mediaType: 'video' })
    expect(json.data.thumbnailUrl).toContain('ytimg.com')
  })

  it('422s an un-allowlisted provider — and never fetches', async () => {
    const fetchImpl = vi.fn()
    const app = createOembedApi({ resolveActor: owner, fetchImpl })
    const res = await post(app, { url: 'https://random-site.example/x' })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'unsupported_provider' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('400s a missing/invalid url', async () => {
    const app = createOembedApi({ resolveActor: owner })
    expect((await post(app, {})).status).toBe(400)
    expect((await post(app, { url: 123 })).status).toBe(400)
  })

  it('502s when the provider fetch fails upstream', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down')
    })
    const app = createOembedApi({ resolveActor: owner, fetchImpl })
    const res = await post(app, { url: 'https://youtu.be/abc' })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'fetch_failed' })
  })
})

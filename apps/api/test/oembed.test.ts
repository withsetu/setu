import { describe, it, expect, vi } from 'vitest'
import { createOembedApi } from '../src/oembed'
import type { ResolveActor } from '../src/auth/resolve-actor'

const author: ResolveActor = () => ({ id: 'au', role: 'author' })
const anon: ResolveActor = () => null

// The factory now always wraps its transport in the SSRF guard (#626), so every test injects the
// RAW transport plus a stub DNS resolver (a public address) instead of a bypassing `fetchImpl` —
// no test may exercise a path the production mount doesn't have.
const resolveHost = async () => ['93.184.216.34']

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

  // Note: a 403 (authenticated-but-unauthorized) is unreachable for this endpoint — every role in
  // the current matrix (admin/maintainer/editor/author) holds content.create, so `author` is the
  // lowest actor and it IS admitted (below). The enforced boundary is 401 for a null actor.

  it('200s with normalized data for an author-role actor (the lowest authorized role is admitted)', async () => {
    const fetchImpl = vi.fn(async () => jsonRes(YT))
    const app = createOembedApi({
      resolveActor: () => ({ id: 'a', role: 'author' }),
      transport: fetchImpl,
      resolveHost
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
    const app = createOembedApi({
      resolveActor: author,
      transport: fetchImpl,
      resolveHost
    })
    const res = await post(app, { url: 'https://random-site.example/x' })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'unsupported_provider' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('400s a missing/invalid url', async () => {
    const app = createOembedApi({ resolveActor: author })
    expect((await post(app, {})).status).toBe(400)
    expect((await post(app, { url: 123 })).status).toBe(400)
  })

  it('502s when the provider fetch fails upstream', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down')
    })
    const app = createOembedApi({
      resolveActor: author,
      transport: fetchImpl,
      resolveHost
    })
    const res = await post(app, { url: 'https://youtu.be/abc' })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'fetch_failed' })
  })
})

// #626 — the route MUST resolve through the shared safeFetch seam by default. Before the fix the
// mount passed no fetchImpl at all, so core fell back to `globalThis.fetch` with the default
// `redirect: 'follow'`: the provider allowlist pinned only the FIRST hop and a 302 to
// 169.254.169.254 was followed with no re-validation.
describe('createOembedApi — SSRF guard is on by default (#626)', () => {
  // The redirect-FOLLOWING policy belongs to the transport, so a stub can't reproduce it. What IS
  // observable here — and what was broken before the fix — is that the provider request reaches
  // the transport with `redirect: 'manual'`: that switch is what makes the GUARD, rather than
  // undici, decide where a 302 goes. Before the fix core called `globalThis.fetch` with no
  // `redirect` option at all (the 'follow' default), so a provider 302 to 169.254.169.254 was
  // fetched by the platform with no re-validation. The hop-by-hop refusal itself is covered
  // end-to-end against the real adapter in safe-fetch-impl.test.ts.
  it('drives the provider request through the guard: redirect handling is manual, not the platform default', async () => {
    const calls: { url: string; redirect: string | undefined }[] = []
    const transport = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), redirect: init?.redirect })
      return jsonRes(YT)
    }) as unknown as typeof fetch
    const app = createOembedApi({
      resolveActor: author,
      transport,
      resolveHost
    })
    expect((await post(app, { url: 'https://youtu.be/abc' })).status).toBe(200)
    expect(calls).toEqual([
      {
        url: 'https://www.youtube.com/oembed?url=https%3A%2F%2Fyoutu.be%2Fabc&format=json',
        redirect: 'manual'
      }
    ])
  })

  it('refuses a provider redirect to cloud metadata: 502, and the metadata host is never fetched', async () => {
    const calls: string[] = []
    const transport = vi.fn(async (input: string | URL) => {
      calls.push(String(input))
      return new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' }
      })
    }) as unknown as typeof fetch
    const app = createOembedApi({
      resolveActor: author,
      transport,
      resolveHost
    })
    const res = await post(app, { url: 'https://youtu.be/abc' })
    expect(res.status).toBe(502) // mapped, NOT an escaped 500
    const body = (await res.json()) as { error: string }
    expect(body).toEqual({ error: 'fetch_failed' })
    expect(calls).toEqual([
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fyoutu.be%2Fabc&format=json'
    ])
    // The blocked internal address must never leak into the client-visible response.
    expect(JSON.stringify(body)).not.toContain('169.254')
  })

  it('refuses a provider redirect off the provider allowlist', async () => {
    const transport = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example/x' }
        })
    ) as unknown as typeof fetch
    const app = createOembedApi({
      resolveActor: author,
      transport,
      resolveHost
    })
    expect((await post(app, { url: 'https://youtu.be/abc' })).status).toBe(502)
  })

  it('caps an oversized provider response instead of buffering it whole', async () => {
    const transport = vi.fn(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-length': String(50 * 1024 * 1024) }
        })
    ) as unknown as typeof fetch
    const app = createOembedApi({
      resolveActor: author,
      transport,
      resolveHost
    })
    const res = await post(app, { url: 'https://youtu.be/abc' })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'fetch_failed' })
  })

  it('blocks a provider host that resolves to a private address', async () => {
    const transport = vi.fn() as unknown as typeof fetch
    const app = createOembedApi({
      resolveActor: author,
      transport,
      resolveHost: async () => ['169.254.169.254']
    })
    expect((await post(app, { url: 'https://youtu.be/abc' })).status).toBe(502)
    expect(transport).not.toHaveBeenCalled()
  })
})

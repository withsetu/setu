import { describe, expect, it } from 'vitest'
import { createPreviewApi } from '../src/preview'

const req = (
  app: ReturnType<typeof createPreviewApi>,
  path: string,
  init?: RequestInit
) => app.fetch(new Request(`http://test${path}`, init))

const draft = {
  content: '---\ntitle: Hi\n---\nHello',
  collection: 'post',
  locale: 'en',
  slug: 'hi'
}

describe('preview api', () => {
  it('404 when no draft has been pushed', async () => {
    const res = await req(createPreviewApi(), '/preview')
    expect(res.status).toBe(404)
  })

  it('stores a posted draft and returns it', async () => {
    const app = createPreviewApi()
    const post = await req(app, '/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft)
    })
    expect(post.status).toBe(200)
    const res = await req(app, '/preview')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(draft)
  })

  it('the latest POST wins (single slot)', async () => {
    const app = createPreviewApi()
    const send = (d: typeof draft) =>
      req(app, '/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(d)
      })
    await send(draft)
    await send({ ...draft, slug: 'second', content: 'second body' })
    expect(await (await req(app, '/preview')).json()).toMatchObject({
      slug: 'second'
    })
  })

  // CORS is no longer set by this factory standalone — server.ts owns the allowlisted `cors()` +
  // originGuard centrally once this app is mounted (#248). Verified in
  // apps/api/test/auth-routes.test.ts / origin-guard.test.ts, not here.

  // #419 — the preview slot is an unauthenticated read/write surface: the site's dev-only /preview
  // route GETs it server-side with no session cookie, so it can't be auth-gated. Instead the routes
  // are mounted ONLY in dev (server.ts passes `enabled: NODE_ENV !== 'production'`); in production
  // they are absent, so an attacker can neither read the current draft nor poison the slot.
  it('is DISABLED in production: POST and GET /preview both 404 (routes absent)', async () => {
    const app = createPreviewApi({ enabled: false })
    expect((await req(app, '/preview')).status).toBe(404)
    const post = await req(app, '/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft)
    })
    expect(post.status).toBe(404)
  })

  it('is ENABLED in dev: POST stores and GET returns the draft', async () => {
    const app = createPreviewApi({ enabled: true })
    const post = await req(app, '/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft)
    })
    expect(post.status).toBe(200)
    expect((await req(app, '/preview')).status).toBe(200)
  })

  it('caps the POST body — oversize → 413', async () => {
    const app = createPreviewApi()
    const oversize = '{"content":"' + 'a'.repeat(1024 * 1024 + 1024) + '"}'
    const res = await req(app, '/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: oversize
    })
    expect(res.status).toBe(413)
  })
})

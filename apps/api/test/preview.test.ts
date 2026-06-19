import { describe, expect, it } from 'vitest'
import { createPreviewApi } from '../src/preview'

const req = (app: ReturnType<typeof createPreviewApi>, path: string, init?: RequestInit) =>
  app.fetch(new Request(`http://test${path}`, init))

const draft = { content: '---\ntitle: Hi\n---\nHello', collection: 'post', locale: 'en', slug: 'hi' }

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
      body: JSON.stringify(draft),
    })
    expect(post.status).toBe(200)
    const res = await req(app, '/preview')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(draft)
  })

  it('the latest POST wins (single slot)', async () => {
    const app = createPreviewApi()
    const send = (d: typeof draft) =>
      req(app, '/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) })
    await send(draft)
    await send({ ...draft, slug: 'second', content: 'second body' })
    expect(await (await req(app, '/preview')).json()).toMatchObject({ slug: 'second' })
  })

  it('sets CORS headers (admin posts cross-origin)', async () => {
    const res = await req(createPreviewApi(), '/preview', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
  })
})

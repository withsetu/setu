import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { securityHeaders } from '../src/security-headers'

// #289 baseline: every API response carries the three defensive headers. The API serves JSON +
// media assets — no CSP here (that's a document-context policy; the site emits its own).
function makeApp() {
  const app = new Hono()
  app.use('*', securityHeaders())
  app.get('/ping', (c) => c.json({ ok: true }))
  app.get('/boom', () => {
    throw new Error('boom')
  })
  return app
}

const expectBaseline = (res: Response) => {
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  // DENY (stricter than the site's SAMEORIGIN): the API is never legitimately framed.
  expect(res.headers.get('X-Frame-Options')).toBe('DENY')
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
  // JSON/media API — no CSP, enforcing or report-only.
  expect(res.headers.get('Content-Security-Policy')).toBeNull()
  expect(res.headers.get('Content-Security-Policy-Report-Only')).toBeNull()
}

describe('api securityHeaders middleware (#289)', () => {
  it('sets the three headers on a normal route response', async () => {
    const res = await makeApp().request('/ping')
    expect(res.status).toBe(200)
    expectBaseline(res)
  })

  it('sets them on 404s too (unmatched route)', async () => {
    const res = await makeApp().request('/nope')
    expect(res.status).toBe(404)
    expectBaseline(res)
  })

  it('sets them on error responses (thrown handler → 500)', async () => {
    const res = await makeApp().request('/boom')
    expect(res.status).toBe(500)
    expectBaseline(res)
  })
})

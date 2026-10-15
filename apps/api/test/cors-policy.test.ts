import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { apiCors, PUBLIC_PATHS } from '../src/auth/cors-policy'

// #1264: the public contact-form submit route answers any visitor origin with a NON-credentialed
// CORS policy, so a site on a different origin from the API can read the result of its own
// submission. Every other route keeps the credentialed allowlist. These tests drive the same
// middleware server.ts mounts (src/auth/cors-policy.ts), not a copy of it.
const ADMIN = 'http://localhost:5173'
const SITE = 'https://www.example.org'

function build() {
  const app = new Hono()
  app.use(
    '*',
    apiCors(() => [ADMIN])
  )
  app.post('/forms/submit', (c) => c.json({ ok: true }))
  app.get('/forms/submissions', (c) => c.json([]))
  app.post('/forms/submissions', (c) => c.json({}, 201))
  app.get('/api/capabilities', (c) => c.json({}))
  return app
}

const req = (path: string, init: RequestInit) =>
  build().fetch(new Request(`http://api${path}`, init))

describe('apiCors — public submit route (#1264)', () => {
  it('lists /forms/submit as the only public path', () => {
    expect(PUBLIC_PATHS).toEqual(['/forms/submit'])
  })

  it('answers the JSON preflight from a site origin that is not on the allowlist', async () => {
    const res = await req('/forms/submit', {
      method: 'OPTIONS',
      headers: {
        origin: SITE,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type'
      }
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    expect(
      res.headers.get('access-control-allow-headers')?.toLowerCase()
    ).toContain('content-type')
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('lets a site origin read the submit response, without credentials', async () => {
    const res = await req('/forms/submit', {
      method: 'POST',
      headers: { origin: SITE }
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('never grants credentials on the submit route, even to an allowlisted origin', async () => {
    const res = await req('/forms/submit', {
      method: 'POST',
      headers: { origin: ADMIN }
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })
})

describe('apiCors — everything else stays on the credentialed allowlist', () => {
  for (const path of ['/forms/submissions', '/api/capabilities']) {
    it(`${path}: an unlisted site origin gets no CORS grant`, async () => {
      const res = await req(path, { method: 'GET', headers: { origin: SITE } })
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
    })

    it(`${path}: the admin origin gets a credentialed grant`, async () => {
      const res = await req(path, { method: 'GET', headers: { origin: ADMIN } })
      expect(res.headers.get('access-control-allow-origin')).toBe(ADMIN)
      expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    })
  }

  it('a path that merely starts with the public path is not public', async () => {
    const res = await req('/forms/submissions', {
      method: 'OPTIONS',
      headers: { origin: SITE, 'access-control-request-method': 'POST' }
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

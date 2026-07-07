import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { originGuard } from '../src/auth/origin-guard'
import { allowedOrigins } from '../src/auth/allowed-origins'

function makeApp(allowed: () => string[]) {
  const app = new Hono()
  app.use('*', originGuard(allowed))
  app.get('/ping', (c) => c.json({ ok: true }))
  app.post('/ping', (c) => c.json({ ok: true }))
  app.on(
    ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'],
    '/ping',
    (c) => c.json({ ok: true })
  )
  return app
}

const req = (
  app: ReturnType<typeof makeApp>,
  path: string,
  init?: RequestInit
) => app.fetch(new Request(`http://ignored${path}`, init))

describe('originGuard', () => {
  it('GET passes regardless of Origin/Host (safe method)', async () => {
    const app = makeApp(() => ['https://trusted.example'])
    const res = await req(app, '/ping', {
      method: 'GET',
      headers: { origin: 'https://evil.example', host: 'evil.example' }
    })
    expect(res.status).toBe(200)
  })

  it('HEAD and OPTIONS pass regardless (safe methods)', async () => {
    const app = makeApp(() => ['https://trusted.example'])
    const head = await req(app, '/ping', {
      method: 'HEAD',
      headers: { origin: 'https://evil.example' }
    })
    expect(head.status).toBe(200)
    const opts = await req(app, '/ping', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' }
    })
    expect(opts.status).toBe(200)
  })

  it('POST with a trusted Origin passes', async () => {
    const app = makeApp(() => ['https://trusted.example'])
    const res = await req(app, '/ping', {
      method: 'POST',
      headers: { origin: 'https://trusted.example', host: 'api.internal' }
    })
    expect(res.status).toBe(200)
  })

  it('POST with an untrusted Origin -> 403 JSON', async () => {
    const app = makeApp(() => ['https://trusted.example'])
    const res = await req(app, '/ping', {
      method: 'POST',
      headers: { origin: 'https://evil.example', host: 'api.internal' }
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'origin not allowed' })
  })

  it('POST with Origin matching a wildcard-subdomain allowlist entry passes', async () => {
    const app = makeApp(() => ['https://*.trycloudflare.com'])
    const res = await req(app, '/ping', {
      method: 'POST',
      headers: { origin: 'https://random-tunnel.trycloudflare.com' }
    })
    expect(res.status).toBe(200)
  })

  it('POST with Origin matching wrong scheme for a wildcard entry -> 403', async () => {
    const app = makeApp(() => ['https://*.trycloudflare.com'])
    const res = await req(app, '/ping', {
      method: 'POST',
      headers: { origin: 'http://random-tunnel.trycloudflare.com' }
    })
    expect(res.status).toBe(403)
  })

  it('POST with no Origin from a loopback Host (localhost) passes', async () => {
    const app = makeApp(() => ['https://trusted.example'])
    const res = await req(app, '/ping', {
      method: 'POST',
      headers: { host: 'localhost:4444' }
    })
    expect(res.status).toBe(200)
  })

  it('POST with no Origin from a loopback Host (127.0.0.1) passes', async () => {
    const app = makeApp(() => ['https://trusted.example'])
    const res = await req(app, '/ping', {
      method: 'POST',
      headers: { host: '127.0.0.1:4444' }
    })
    expect(res.status).toBe(200)
  })

  it('POST with no Origin from a loopback Host ([::1]) passes', async () => {
    const app = makeApp(() => ['https://trusted.example'])
    const res = await req(app, '/ping', {
      method: 'POST',
      headers: { host: '[::1]:4444' }
    })
    expect(res.status).toBe(200)
  })

  it('POST with no Origin and Host matching an allowlisted origin host passes', async () => {
    const app = makeApp(() => ['https://trusted.example'])
    const res = await req(app, '/ping', {
      method: 'POST',
      headers: { host: 'trusted.example' }
    })
    expect(res.status).toBe(200)
  })

  it('POST with no Origin and an unrecognized Host -> 403', async () => {
    const app = makeApp(() => ['https://trusted.example'])
    const res = await req(app, '/ping', {
      method: 'POST',
      headers: { host: 'sneaky.example' }
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'origin not allowed' })
  })

  it('POST with no Origin and no Host at all -> 403 (fail closed)', async () => {
    const app = makeApp(() => ['https://trusted.example'])
    const res = await req(app, '/ping', { method: 'POST' })
    expect(res.status).toBe(403)
  })
})

describe('originGuard publicPaths', () => {
  function makeAppWithPublicPaths(
    allowed: () => string[],
    publicPaths: string[]
  ) {
    const app = new Hono()
    app.use('*', originGuard(allowed, { publicPaths }))
    app.post('/forms/submit', (c) => c.json({ ok: true }))
    app.post('/forms/submissions', (c) => c.json({ ok: true }))
    return app
  }

  it('a publicPaths request with an untrusted Origin passes through (bypasses the origin check)', async () => {
    const app = makeAppWithPublicPaths(
      () => ['https://trusted.example'],
      ['/forms/submit']
    )
    const res = await req(app, '/forms/submit', {
      method: 'POST',
      headers: { origin: 'https://evil.example' }
    })
    expect(res.status).toBe(200)
  })

  it('a non-public path with the same untrusted Origin is still 403', async () => {
    const app = makeAppWithPublicPaths(
      () => ['https://trusted.example'],
      ['/forms/submit']
    )
    const res = await req(app, '/forms/submissions', {
      method: 'POST',
      headers: { origin: 'https://evil.example' }
    })
    expect(res.status).toBe(403)
  })

  it('with opts absent, default behavior is unchanged (untrusted Origin -> 403)', async () => {
    const app = makeApp(() => ['https://trusted.example'])
    const res = await req(app, '/ping', {
      method: 'POST',
      headers: { origin: 'https://evil.example' }
    })
    expect(res.status).toBe(403)
  })
})

describe('allowedOrigins', () => {
  it('defaults: admin origin (localhost:5173) + loopback API origins (localhost/127.0.0.1 on SETU_API_PORT default 4444)', () => {
    const origins = allowedOrigins({})
    expect(origins).toContain('http://localhost:5173')
    expect(origins).toContain('http://localhost:4444')
    expect(origins).toContain('http://127.0.0.1:4444')
  })

  it('SETU_ADMIN_ORIGIN overrides the default admin origin', () => {
    const origins = allowedOrigins({
      SETU_ADMIN_ORIGIN: 'https://admin.example.com'
    })
    expect(origins).toContain('https://admin.example.com')
    expect(origins).not.toContain('http://localhost:5173')
  })

  it('SETU_API_PORT changes the loopback API origins', () => {
    const origins = allowedOrigins({ SETU_API_PORT: '9999' })
    expect(origins).toContain('http://localhost:9999')
    expect(origins).toContain('http://127.0.0.1:9999')
    expect(origins).not.toContain('http://localhost:4444')
  })

  it('SETU_TRUSTED_ORIGINS is comma-separated, trimmed, empties dropped, wildcard preserved', () => {
    const origins = allowedOrigins({
      SETU_TRUSTED_ORIGINS:
        ' https://example.com , https://*.trycloudflare.com ,, https://other.com '
    })
    expect(origins).toContain('https://example.com')
    expect(origins).toContain('https://*.trycloudflare.com')
    expect(origins).toContain('https://other.com')
    // no empty-string entries
    expect(origins.every((o) => o.length > 0)).toBe(true)
  })

  it('omits SETU_TRUSTED_ORIGINS entirely when unset', () => {
    const origins = allowedOrigins({})
    // Should just be admin + loopback, nothing else
    expect(origins.sort()).toEqual(
      [
        'http://localhost:5173',
        'http://localhost:4444',
        'http://127.0.0.1:4444'
      ].sort()
    )
  })
})

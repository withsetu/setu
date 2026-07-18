import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { originGuard } from '../src/auth/origin-guard'
import { allowedOrigins, resolveAdminOrigin } from '../src/auth/allowed-origins'

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
  const local = (extra: NodeJS.ProcessEnv = {}) =>
    allowedOrigins({ SETU_MODE: 'local', ...extra })

  it('local mode defaults: admin origin (localhost:5173) + loopback API origins (localhost/127.0.0.1 on SETU_API_PORT default 4444)', () => {
    const origins = local()
    expect(origins).toContain('http://localhost:5173')
    expect(origins).toContain('http://localhost:4444')
    expect(origins).toContain('http://127.0.0.1:4444')
  })

  it('SETU_ADMIN_ORIGIN overrides the default admin origin', () => {
    const origins = local({ SETU_ADMIN_ORIGIN: 'https://admin.example.com' })
    expect(origins).toContain('https://admin.example.com')
    expect(origins).not.toContain('http://localhost:5173')
  })

  it('SETU_API_PORT changes the loopback API origins', () => {
    const origins = local({ SETU_API_PORT: '9999' })
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
    const origins = local()
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

// #628 — this list feeds the CREDENTIALED cors() and originGuard. Loopback origins on it in a
// non-local topology mean any page served from http://localhost:<apiPort> (a dev server, another
// app, a malicious local process) can make credentialed cross-origin READS AND WRITES against a
// production server. Loopback is a local-only affordance, like every other one in config.ts.
describe('allowedOrigins — loopback is local-only (#628)', () => {
  const noop = () => undefined

  it('omits loopback origins when SETU_MODE is unset (fail closed to self-hosted)', () => {
    vi.spyOn(console, 'error').mockImplementation(noop)
    const origins = allowedOrigins({
      SETU_ADMIN_ORIGIN: 'https://admin.example.com'
    })
    expect(origins).not.toContain('http://localhost:4444')
    expect(origins).not.toContain('http://127.0.0.1:4444')
    expect(origins).toEqual(['https://admin.example.com'])
  })

  it('omits loopback origins in explicit self-hosted mode, on any port', () => {
    const origins = allowedOrigins({
      SETU_MODE: 'self-hosted',
      SETU_API_PORT: '9999',
      SETU_ADMIN_ORIGIN: 'https://admin.example.com'
    })
    expect(origins.some((o) => o.includes('localhost'))).toBe(false)
    expect(origins.some((o) => o.includes('127.0.0.1'))).toBe(false)
  })

  it('does NOT silently default the admin origin to localhost outside local mode — it fails loudly', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(noop)
    const origins = allowedOrigins({ SETU_MODE: 'self-hosted' })
    expect(origins).not.toContain('http://localhost:5173')
    expect(origins).toEqual([])
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining('SETU_ADMIN_ORIGIN')
    )
  })

  it('still honours SETU_TRUSTED_ORIGINS in self-hosted mode', () => {
    const origins = allowedOrigins({
      SETU_MODE: 'self-hosted',
      SETU_ADMIN_ORIGIN: 'https://admin.example.com',
      SETU_TRUSTED_ORIGINS: 'https://*.example.com'
    })
    expect(origins).toEqual([
      'https://admin.example.com',
      'https://*.example.com'
    ])
  })
})

// #642(a) — #628 mode-gated the allowlist but server.ts kept its OWN
// `process.env.SETU_ADMIN_ORIGIN ?? 'http://localhost:5173'`, so the admin origin that feeds the
// password-reset callback disagreed with the allowlist that has to accept it. One resolver now
// governs both; these tests pin the agreement, not just the values.
describe('resolveAdminOrigin — one mode-aware source (#642)', () => {
  const noop = () => undefined

  it('local mode defaults to the admin dev server', () => {
    expect(resolveAdminOrigin({ SETU_MODE: 'local' })).toBe(
      'http://localhost:5173'
    )
  })

  it('SETU_ADMIN_ORIGIN wins in local mode', () => {
    expect(
      resolveAdminOrigin({
        SETU_MODE: 'local',
        SETU_ADMIN_ORIGIN: 'https://admin.example.com'
      })
    ).toBe('https://admin.example.com')
  })

  it('returns the configured origin in self-hosted mode', () => {
    expect(
      resolveAdminOrigin({
        SETU_MODE: 'self-hosted',
        SETU_ADMIN_ORIGIN: 'https://admin.example.com'
      })
    ).toBe('https://admin.example.com')
  })

  it('does NOT default to localhost when SETU_MODE is unset (fail closed)', () => {
    expect(resolveAdminOrigin({})).toBeUndefined()
  })

  it('does NOT default to localhost in explicit self-hosted mode', () => {
    expect(resolveAdminOrigin({ SETU_MODE: 'self-hosted' })).toBeUndefined()
  })

  it('treats an empty SETU_ADMIN_ORIGIN as unset, exactly like the allowlist does', () => {
    expect(
      resolveAdminOrigin({ SETU_MODE: 'local', SETU_ADMIN_ORIGIN: '' })
    ).toBe('http://localhost:5173')
    expect(
      resolveAdminOrigin({ SETU_MODE: 'self-hosted', SETU_ADMIN_ORIGIN: '' })
    ).toBeUndefined()
  })

  // The property that actually matters: whatever origin the reset callback is built from must be
  // on the credentialed allowlist better-auth's originCheck consults. If these two can disagree,
  // the server emails a link its own origin check rejects — the #642 defect.
  it.each([
    { SETU_MODE: 'local' },
    { SETU_MODE: 'local', SETU_ADMIN_ORIGIN: 'https://admin.example.com' },
    {
      SETU_MODE: 'self-hosted',
      SETU_ADMIN_ORIGIN: 'https://admin.example.com'
    },
    { SETU_ADMIN_ORIGIN: 'https://admin.example.com' },
    { SETU_MODE: 'self-hosted' },
    {}
  ])('a resolved admin origin is always on the allowlist (%o)', (env) => {
    vi.spyOn(console, 'error').mockImplementation(noop)
    const admin = resolveAdminOrigin(env)
    if (admin === undefined) return // nothing claimed → nothing to be inconsistent about
    expect(allowedOrigins(env)).toContain(admin)
  })
})

// #642(b) — allowedOrigins was invoked from the per-request cors() origin callback AND the
// originGuard thunk, so a misconfigured self-hosted server emitted the fail-loud console.error up
// to twice PER REQUEST: a log flood any unauthenticated caller could drive, burying the very
// message it exists to surface. The derivation reads process.env, which does not change per
// request, so it is memoised per env object — the error is emitted once.
describe('allowedOrigins — derived once per env, not per request (#642)', () => {
  const noop = () => undefined

  it('logs the misconfiguration error ONCE across many calls with the same env', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(noop)
    const env: NodeJS.ProcessEnv = { SETU_MODE: 'self-hosted' }
    for (let i = 0; i < 50; i++) allowedOrigins(env)
    expect(err).toHaveBeenCalledTimes(1)
  })

  it('returns the same allowlist on every call (memoised, semantics unchanged)', () => {
    const env: NodeJS.ProcessEnv = {
      SETU_MODE: 'self-hosted',
      SETU_ADMIN_ORIGIN: 'https://admin.example.com',
      SETU_TRUSTED_ORIGINS: 'https://*.example.com'
    }
    const first = allowedOrigins(env)
    const second = allowedOrigins(env)
    expect(second).toEqual([
      'https://admin.example.com',
      'https://*.example.com'
    ])
    expect(second).toEqual(first)
  })

  it('a caller mutating the returned array cannot poison the next caller', () => {
    const env: NodeJS.ProcessEnv = {
      SETU_MODE: 'local',
      SETU_ADMIN_ORIGIN: 'https://admin.example.com'
    }
    allowedOrigins(env).push('https://evil.example')
    expect(allowedOrigins(env)).not.toContain('https://evil.example')
  })

  it('still derives independently for a different env object', () => {
    vi.spyOn(console, 'error').mockImplementation(noop)
    const a = allowedOrigins({
      SETU_MODE: 'local',
      SETU_ADMIN_ORIGIN: 'https://a.example'
    })
    const b = allowedOrigins({
      SETU_MODE: 'local',
      SETU_ADMIN_ORIGIN: 'https://b.example'
    })
    expect(a).toContain('https://a.example')
    expect(b).toContain('https://b.example')
    expect(b).not.toContain('https://a.example')
  })
})

import { afterEach, describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { openSqliteDb, countUsers, user as userTable } from '@setu/db-sqlite'
import {
  buildCapabilities,
  createCapabilitiesApi,
  emailCapabilityFromEnv
} from '../src/capabilities'
import {
  socialProvidersEnabled,
  captchaCapabilityFromEnv
} from '../src/auth/env'

const NO_AUTH = {
  enabled: false,
  providers: [],
  captcha: null,
  needsSetup: false
}

const NO_EMAIL = { transport: 'console', deliverable: false }

describe('capabilities', () => {
  it('imageProcessing is true only when an image adapter is wired', () => {
    expect(
      buildCapabilities({
        image: {},
        writableMediaStore: true,
        backgroundJobs: true,
        auth: NO_AUTH,
        email: NO_EMAIL
      }).capabilities.imageProcessing
    ).toBe(true)
    expect(
      buildCapabilities({
        writableMediaStore: true,
        backgroundJobs: true,
        auth: NO_AUTH,
        email: NO_EMAIL
      }).capabilities.imageProcessing
    ).toBe(false)
  })

  it('serves the capability object at GET /api/capabilities', async () => {
    const base = buildCapabilities({
      image: {},
      writableMediaStore: true,
      backgroundJobs: true,
      mode: 'self-hosted',
      auth: NO_AUTH,
      email: NO_EMAIL
    })
    const app = createCapabilitiesApi(base, () => NO_AUTH)
    const res = await app.fetch(new Request('http://test/api/capabilities'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mode: 'self-hosted',
      capabilities: {
        imageProcessing: true,
        writableMediaStore: true,
        backgroundJobs: true
      },
      auth: NO_AUTH,
      email: NO_EMAIL
    })
  })

  // Regression coverage for the CORS-clobbering bug: capabilities.ts carried its own permissive
  // `app.use('*', cors())`, which — once mounted under a central allowlisted `cors()` in
  // server.ts — silently overrode it back to `Access-Control-Allow-Origin: *` (last-write-wins in
  // Hono). These tests verify the central CORS policy is not clobbered when capabilities is
  // mounted under it.
  it('with central CORS allowlist: trusted Origin -> access-control-allow-origin echoes that origin', async () => {
    const trustedOrigin = 'http://localhost:5173'
    const app = new Hono()
    app.use(
      '*',
      cors({
        origin: (origin) => (origin === trustedOrigin ? origin : undefined),
        credentials: true
      })
    )
    app.route(
      '/',
      createCapabilitiesApi(
        buildCapabilities({
          image: {},
          writableMediaStore: true,
          backgroundJobs: true,
          auth: NO_AUTH,
          email: NO_EMAIL
        }),
        () => NO_AUTH
      )
    )
    const res = await app.fetch(
      new Request('http://test/api/capabilities', {
        headers: { origin: trustedOrigin }
      })
    )
    expect(res.headers.get('access-control-allow-origin')).toBe(trustedOrigin)
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('with central CORS allowlist: untrusted Origin -> access-control-allow-origin is absent', async () => {
    const trustedOrigin = 'http://localhost:5173'
    const app = new Hono()
    app.use(
      '*',
      cors({
        origin: (origin) => (origin === trustedOrigin ? origin : undefined),
        credentials: true
      })
    )
    app.route(
      '/',
      createCapabilitiesApi(
        buildCapabilities({
          image: {},
          writableMediaStore: true,
          backgroundJobs: true,
          auth: NO_AUTH,
          email: NO_EMAIL
        }),
        () => NO_AUTH
      )
    )
    const res = await app.fetch(
      new Request('http://test/api/capabilities', {
        headers: { origin: 'https://evil.example' }
      })
    )
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  describe('auth block: computed per-request (needsSetup changes after setup)', () => {
    it('reflects a live thunk, not a boot-time snapshot', async () => {
      let needsSetup = true
      const base = buildCapabilities({
        writableMediaStore: true,
        backgroundJobs: true,
        auth: NO_AUTH,
        email: NO_EMAIL
      })
      const app = createCapabilitiesApi(base, () => ({
        enabled: true,
        providers: [],
        captcha: null,
        needsSetup
      }))

      const first = await app.fetch(new Request('http://test/api/capabilities'))
      expect(((await first.json()) as any).auth.needsSetup).toBe(true)

      needsSetup = false // simulate first-run setup completing between requests
      const second = await app.fetch(
        new Request('http://test/api/capabilities')
      )
      expect(((await second.json()) as any).auth.needsSetup).toBe(false)
    })
  })

  describe('socialProvidersEnabled (shared env helper, reused not duplicated)', () => {
    it('is empty when no provider env pairs are set', () => {
      expect(socialProvidersEnabled({})).toEqual([])
    })

    it('includes github only when BOTH its client id and secret are set', () => {
      expect(
        socialProvidersEnabled({
          SETU_GITHUB_CLIENT_ID: 'id'
        })
      ).toEqual([])
      expect(
        socialProvidersEnabled({
          SETU_GITHUB_CLIENT_ID: 'id',
          SETU_GITHUB_CLIENT_SECRET: 'secret'
        })
      ).toEqual(['github'])
    })

    it('includes both when both pairs are complete', () => {
      expect(
        socialProvidersEnabled({
          SETU_GITHUB_CLIENT_ID: 'id',
          SETU_GITHUB_CLIENT_SECRET: 'secret',
          SETU_GOOGLE_CLIENT_ID: 'gid',
          SETU_GOOGLE_CLIENT_SECRET: 'gsecret'
        })
      ).toEqual(['github', 'google'])
    })
  })

  describe('captchaCapabilityFromEnv (public site key only, never the secret)', () => {
    it('is null when no provider is configured', () => {
      expect(captchaCapabilityFromEnv({})).toBeNull()
    })

    it('is null when provider + secret are set but the PUBLIC site key is missing', () => {
      expect(
        captchaCapabilityFromEnv({
          SETU_CAPTCHA_PROVIDER: 'turnstile',
          SETU_TURNSTILE_SECRET: 'shh'
        })
      ).toBeNull()
    })

    it('is null when the site key is set but the secret is not (fail closed, matches authCaptchaFromEnv)', () => {
      expect(
        captchaCapabilityFromEnv({
          SETU_CAPTCHA_PROVIDER: 'turnstile',
          SETU_TURNSTILE_SITE_KEY: 'pk_test'
        })
      ).toBeNull()
    })

    it('returns { provider, siteKey } when fully configured, and never leaks the secret value', () => {
      const cap = captchaCapabilityFromEnv({
        SETU_CAPTCHA_PROVIDER: 'turnstile',
        SETU_TURNSTILE_SECRET: 'super-secret-value',
        SETU_TURNSTILE_SITE_KEY: 'pk_test_123'
      })
      expect(cap).toEqual({ provider: 'turnstile', siteKey: 'pk_test_123' })
      expect(JSON.stringify(cap)).not.toContain('super-secret-value')
    })

    it('supports recaptcha the same way', () => {
      const cap = captchaCapabilityFromEnv({
        SETU_CAPTCHA_PROVIDER: 'recaptcha',
        SETU_RECAPTCHA_SECRET: 'super-secret-value',
        SETU_RECAPTCHA_SITE_KEY: 'site_key_abc'
      })
      expect(cap).toEqual({ provider: 'recaptcha', siteKey: 'site_key_abc' })
    })
  })

  describe('emailCapabilityFromEnv (#364 — mirrors server.ts adapter selection, never inferred)', () => {
    it('defaults to console/not-deliverable when SETU_EMAIL_ADAPTER is unset', () => {
      expect(emailCapabilityFromEnv({})).toEqual({
        transport: 'console',
        deliverable: false
      })
    })

    it('console adapter is explicitly not deliverable', () => {
      expect(emailCapabilityFromEnv({ SETU_EMAIL_ADAPTER: 'console' })).toEqual(
        { transport: 'console', deliverable: false }
      )
    })

    it('an unrecognized transport value reports itself but stays not-deliverable (matches server.ts falling back to console)', () => {
      expect(
        emailCapabilityFromEnv({ SETU_EMAIL_ADAPTER: 'not-a-real-adapter' })
      ).toEqual({ transport: 'not-a-real-adapter', deliverable: false })
    })

    // #364 fix (capability-honesty gap found in whole-branch review): server.ts only wires
    // createAuth's `email` option — the thing that actually enables password-reset sends — when
    // SETU_FORMS_NOTIFY_FROM is set (see the `email: notifyFrom ? {...} : undefined` ternary in
    // server.ts). A resend transport with no from-address previously reported `deliverable: true`
    // even though reset stayed disabled (RESET_PASSWORD_DISABLED) — an enabled-looking UI button
    // that always errors. These three pin the from-address requirement folded into `deliverable`.
    it('resend + no SETU_FORMS_NOTIFY_FROM -> not deliverable (reset would still be disabled)', () => {
      expect(
        emailCapabilityFromEnv({
          SETU_EMAIL_ADAPTER: 'resend',
          RESEND_API_KEY: 'test-fake-key'
        })
      ).toEqual({ transport: 'resend', deliverable: false })
    })

    it('resend + SETU_FORMS_NOTIFY_FROM set -> deliverable (fake key env — no real network call made here)', () => {
      expect(
        emailCapabilityFromEnv({
          SETU_EMAIL_ADAPTER: 'resend',
          RESEND_API_KEY: 'test-fake-key',
          SETU_FORMS_NOTIFY_FROM: 'noreply@example.com'
        })
      ).toEqual({ transport: 'resend', deliverable: true })
    })

    it('console + SETU_FORMS_NOTIFY_FROM set -> still not deliverable (transport, not from-address, gates console)', () => {
      expect(
        emailCapabilityFromEnv({
          SETU_EMAIL_ADAPTER: 'console',
          SETU_FORMS_NOTIFY_FROM: 'noreply@example.com'
        })
      ).toEqual({ transport: 'console', deliverable: false })
    })
  })

  describe('countUsers / needsSetup (real sqlite, via the same drizzle handle createAuth uses)', () => {
    let dir: string
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true })
    })

    it('is 0 on a fresh db (needsSetup would be true)', () => {
      dir = mkdtempSync(join(tmpdir(), 'capabilities-count-users-'))
      const db = openSqliteDb(join(dir, 'auth.db'))
      expect(countUsers(db)).toBe(0)
    })

    it('reflects inserted rows (needsSetup would flip to false)', () => {
      dir = mkdtempSync(join(tmpdir(), 'capabilities-count-users-'))
      const db = openSqliteDb(join(dir, 'auth.db'))
      const now = new Date()
      db.insert(userTable)
        .values({
          id: 'u1',
          name: 'Owner',
          email: 'owner@example.com',
          createdAt: now,
          updatedAt: now
        })
        .run()
      expect(countUsers(db)).toBe(1)
    })
  })

  // #248 Minor 1: server.ts's resolveAuthCapabilities wraps `countUsers(authDb)` in a try/catch so a
  // DB fault (locked file, disk error) degrades needsSetup to false instead of throwing and 500ing
  // the whole /api/capabilities response the admin needs to render anything. This mirrors that
  // guarded-thunk shape directly (server.ts itself is a side-effecting entrypoint never imported in
  // tests — see fail-closed-boot.test.ts / server-setup-wiring.test.ts for the same mirroring
  // pattern) against a real sqlite handle, then forces countUsers to throw.
  describe('needsSetup degrades safe when countUsers throws (fail toward login, never toward setup)', () => {
    function resolveAuthCapabilitiesLike(
      authConfigured: boolean,
      countUsersFn: () => number
    ) {
      let needsSetup = false
      if (authConfigured) {
        try {
          needsSetup = countUsersFn() === 0
        } catch {
          // degrade: needsSetup stays false
        }
      }
      return {
        enabled: authConfigured,
        providers: [],
        captcha: null,
        needsSetup
      }
    }

    it('countUsers throws -> capabilities block still returns, needsSetup: false', () => {
      const throwingCountUsers = () => {
        throw new Error('disk I/O error')
      }
      const auth = resolveAuthCapabilitiesLike(true, throwingCountUsers)
      expect(auth).toEqual({
        enabled: true,
        providers: [],
        captcha: null,
        needsSetup: false
      })
    })

    it('end-to-end: GET /api/capabilities is still 200 with needsSetup:false when the resolver throws', async () => {
      const base = buildCapabilities({
        writableMediaStore: true,
        backgroundJobs: true,
        auth: NO_AUTH,
        email: NO_EMAIL
      })
      const app = createCapabilitiesApi(base, () =>
        resolveAuthCapabilitiesLike(true, () => {
          throw new Error('disk I/O error')
        })
      )
      const res = await app.fetch(new Request('http://test/api/capabilities'))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { auth: { needsSetup: boolean } }
      expect(body.auth.needsSetup).toBe(false)
    })
  })
})

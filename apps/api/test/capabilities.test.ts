import { afterEach, describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { openSqliteDb, countUsers, user as userTable } from '@setu/db-sqlite'
import { buildCapabilities, createCapabilitiesApi } from '../src/capabilities'
import { socialProvidersEnabled, captchaCapabilityFromEnv } from '../src/auth/env'

const NO_AUTH = { enabled: false, providers: [], captcha: null, needsSetup: false }

describe('capabilities', () => {
  it('imageProcessing is true only when an image adapter is wired', () => {
    expect(buildCapabilities({ image: {}, writableMediaStore: true, backgroundJobs: true, auth: NO_AUTH }).capabilities.imageProcessing).toBe(true)
    expect(buildCapabilities({ writableMediaStore: true, backgroundJobs: true, auth: NO_AUTH }).capabilities.imageProcessing).toBe(false)
  })

  it('serves the capability object at GET /api/capabilities', async () => {
    const base = buildCapabilities({ image: {}, writableMediaStore: true, backgroundJobs: true, mode: 'self-hosted', auth: NO_AUTH })
    const app = createCapabilitiesApi(base, () => NO_AUTH)
    const res = await app.fetch(new Request('http://test/api/capabilities'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mode: 'self-hosted',
      capabilities: { imageProcessing: true, writableMediaStore: true, backgroundJobs: true },
      auth: NO_AUTH,
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
        origin: (origin) => origin === trustedOrigin ? origin : undefined,
        credentials: true,
      }),
    )
    app.route('/', createCapabilitiesApi(buildCapabilities({ image: {}, writableMediaStore: true, backgroundJobs: true, auth: NO_AUTH }), () => NO_AUTH))
    const res = await app.fetch(
      new Request('http://test/api/capabilities', { headers: { origin: trustedOrigin } }),
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
        origin: (origin) => origin === trustedOrigin ? origin : undefined,
        credentials: true,
      }),
    )
    app.route('/', createCapabilitiesApi(buildCapabilities({ image: {}, writableMediaStore: true, backgroundJobs: true, auth: NO_AUTH }), () => NO_AUTH))
    const res = await app.fetch(
      new Request('http://test/api/capabilities', { headers: { origin: 'https://evil.example' } }),
    )
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  describe('auth block: computed per-request (needsSetup changes after setup)', () => {
    it('reflects a live thunk, not a boot-time snapshot', async () => {
      let needsSetup = true
      const base = buildCapabilities({ writableMediaStore: true, backgroundJobs: true, auth: NO_AUTH })
      const app = createCapabilitiesApi(base, () => ({ enabled: true, providers: [], captcha: null, needsSetup }))

      const first = await app.fetch(new Request('http://test/api/capabilities'))
      expect((await first.json() as any).auth.needsSetup).toBe(true)

      needsSetup = false // simulate first-run setup completing between requests
      const second = await app.fetch(new Request('http://test/api/capabilities'))
      expect((await second.json() as any).auth.needsSetup).toBe(false)
    })
  })

  describe('socialProvidersEnabled (shared env helper, reused not duplicated)', () => {
    it('is empty when no provider env pairs are set', () => {
      expect(socialProvidersEnabled({} as NodeJS.ProcessEnv)).toEqual([])
    })

    it('includes github only when BOTH its client id and secret are set', () => {
      expect(socialProvidersEnabled({ SETU_GITHUB_CLIENT_ID: 'id' } as NodeJS.ProcessEnv)).toEqual([])
      expect(
        socialProvidersEnabled({ SETU_GITHUB_CLIENT_ID: 'id', SETU_GITHUB_CLIENT_SECRET: 'secret' } as NodeJS.ProcessEnv),
      ).toEqual(['github'])
    })

    it('includes both when both pairs are complete', () => {
      expect(
        socialProvidersEnabled({
          SETU_GITHUB_CLIENT_ID: 'id',
          SETU_GITHUB_CLIENT_SECRET: 'secret',
          SETU_GOOGLE_CLIENT_ID: 'gid',
          SETU_GOOGLE_CLIENT_SECRET: 'gsecret',
        } as NodeJS.ProcessEnv),
      ).toEqual(['github', 'google'])
    })
  })

  describe('captchaCapabilityFromEnv (public site key only, never the secret)', () => {
    it('is null when no provider is configured', () => {
      expect(captchaCapabilityFromEnv({} as NodeJS.ProcessEnv)).toBeNull()
    })

    it('is null when provider + secret are set but the PUBLIC site key is missing', () => {
      expect(
        captchaCapabilityFromEnv({
          SETU_CAPTCHA_PROVIDER: 'turnstile',
          SETU_TURNSTILE_SECRET: 'shh',
        } as NodeJS.ProcessEnv),
      ).toBeNull()
    })

    it('is null when the site key is set but the secret is not (fail closed, matches authCaptchaFromEnv)', () => {
      expect(
        captchaCapabilityFromEnv({
          SETU_CAPTCHA_PROVIDER: 'turnstile',
          SETU_TURNSTILE_SITE_KEY: 'pk_test',
        } as NodeJS.ProcessEnv),
      ).toBeNull()
    })

    it('returns { provider, siteKey } when fully configured, and never leaks the secret value', () => {
      const cap = captchaCapabilityFromEnv({
        SETU_CAPTCHA_PROVIDER: 'turnstile',
        SETU_TURNSTILE_SECRET: 'super-secret-value',
        SETU_TURNSTILE_SITE_KEY: 'pk_test_123',
      } as NodeJS.ProcessEnv)
      expect(cap).toEqual({ provider: 'turnstile', siteKey: 'pk_test_123' })
      expect(JSON.stringify(cap)).not.toContain('super-secret-value')
    })

    it('supports recaptcha the same way', () => {
      const cap = captchaCapabilityFromEnv({
        SETU_CAPTCHA_PROVIDER: 'recaptcha',
        SETU_RECAPTCHA_SECRET: 'super-secret-value',
        SETU_RECAPTCHA_SITE_KEY: 'site_key_abc',
      } as NodeJS.ProcessEnv)
      expect(cap).toEqual({ provider: 'recaptcha', siteKey: 'site_key_abc' })
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
        .values({ id: 'u1', name: 'Owner', email: 'owner@example.com', createdAt: now, updatedAt: now })
        .run()
      expect(countUsers(db)).toBe(1)
    })
  })
})

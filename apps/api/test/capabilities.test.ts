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
  emailCapabilityFromEnv,
  emailTransportOptions,
  publicFrom,
  resolveEmailProvider,
  resolveFromAddress,
  smtpConfigFromEnv,
  usableEmailTransport,
  type EmailCapabilities
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
        history: false,
        auth: NO_AUTH,
        email: NO_EMAIL
      }).capabilities.imageProcessing
    ).toBe(true)
    expect(
      buildCapabilities({
        writableMediaStore: true,
        backgroundJobs: true,
        history: false,
        auth: NO_AUTH,
        email: NO_EMAIL
      }).capabilities.imageProcessing
    ).toBe(false)
  })

  // #466: `history` mirrors whether the git adapter actually has the optional
  // log/readFileAt functions (server.ts derives it with typeof checks) so the
  // admin can hide the History UI instead of rendering a button that 409s.
  it('history reflects what the caller derived from the git adapter', () => {
    for (const history of [true, false] as const) {
      expect(
        buildCapabilities({
          writableMediaStore: true,
          backgroundJobs: true,
          history,
          auth: NO_AUTH,
          email: NO_EMAIL
        }).capabilities.history
      ).toBe(history)
    }
  })

  it('serves the capability object at GET /api/capabilities', async () => {
    const base = buildCapabilities({
      image: {},
      writableMediaStore: true,
      backgroundJobs: true,
      history: true,
      mode: 'self-hosted',
      auth: NO_AUTH,
      email: NO_EMAIL
    })
    const app = createCapabilitiesApi(
      base,
      () => NO_AUTH,
      () => NO_EMAIL
    )
    const res = await app.fetch(new Request('http://test/api/capabilities'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mode: 'self-hosted',
      capabilities: {
        imageProcessing: true,
        writableMediaStore: true,
        backgroundJobs: true,
        history: true
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
          history: false,
          auth: NO_AUTH,
          email: NO_EMAIL
        }),
        () => NO_AUTH,
        () => NO_EMAIL
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
          history: false,
          auth: NO_AUTH,
          email: NO_EMAIL
        }),
        () => NO_AUTH,
        () => NO_EMAIL
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
        history: false,
        auth: NO_AUTH,
        email: NO_EMAIL
      })
      const app = createCapabilitiesApi(
        base,
        () => ({
          enabled: true,
          providers: [],
          captcha: null,
          needsSetup
        }),
        () => NO_EMAIL
      )

      const first = await app.fetch(new Request('http://test/api/capabilities'))
      expect(((await first.json()) as any).auth.needsSetup).toBe(true)

      needsSetup = false // simulate first-run setup completing between requests
      const second = await app.fetch(
        new Request('http://test/api/capabilities')
      )
      expect(((await second.json()) as any).auth.needsSetup).toBe(false)
    })
  })

  // #890: the email block has the same problem `auth` was given a thunk for. Since the provider
  // and the from-address both live in settings.json and both apply to the NEXT send with no
  // restart, a boot snapshot here goes stale the moment an admin saves — and this block is what
  // the admin's password-reset surfaces read: LoginScreen's "Forgot password?" card shows
  // "reset isn't configured for this site" and UsersScreen hides the reset action while
  // `deliverable` is false. A stale false there is the worst kind of dishonesty: reset genuinely
  // works and the UI tells the user it doesn't.
  describe('email block: computed per-request (a settings save must not need a restart)', () => {
    it('reflects a live thunk, not a boot-time snapshot', async () => {
      // Console + a from-address = the exact repro shape: not deliverable at boot, and reset IS
      // wired at boot (a from-address exists), so #886's restart-required copy never fires and
      // nothing else would tell the user the truth.
      const env = {
        SETU_SMTP_HOST: '127.0.0.1',
        SETU_SMTP_PORT: '11025'
      } as NodeJS.ProcessEnv
      let provider = 'console'
      const app = createCapabilitiesApi(
        buildCapabilities({
          writableMediaStore: true,
          backgroundJobs: true,
          history: false,
          auth: NO_AUTH,
          email: emailCapabilityFromEnv(env, 'owner@example.com', provider)
        }),
        () => NO_AUTH,
        () => emailCapabilityFromEnv(env, 'owner@example.com', provider)
      )

      const first = (await (
        await app.fetch(new Request('http://test/api/capabilities'))
      ).json()) as { email: EmailCapabilities }
      expect(first.email).toEqual({ transport: 'console', deliverable: false })

      provider = 'smtp' // the admin saves Settings → Email; no restart

      const second = (await (
        await app.fetch(new Request('http://test/api/capabilities'))
      ).json()) as { email: EmailCapabilities }
      expect(second.email).toEqual({ transport: 'smtp', deliverable: true })
    })

    it('exposes ONLY transport + deliverable — the thunk must not widen an unauthenticated surface', async () => {
      const app = createCapabilitiesApi(
        buildCapabilities({
          writableMediaStore: true,
          backgroundJobs: true,
          history: false,
          auth: NO_AUTH,
          email: NO_EMAIL
        }),
        () => NO_AUTH,
        () =>
          emailCapabilityFromEnv(
            { RESEND_API_KEY: 'test-fake-key' },
            'owner@example.com',
            'resend'
          )
      )
      const body = (await (
        await app.fetch(new Request('http://test/api/capabilities'))
      ).json()) as { email: Record<string, unknown> }
      expect(Object.keys(body.email).sort()).toEqual([
        'deliverable',
        'transport'
      ])
      expect(JSON.stringify(body)).not.toContain('test-fake-key')
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

    // #256: smtp joins resend as a real transport. `deliverable` requires the SAME two things
    // server.ts requires to actually wire the send path: a usable smtp config (host + valid
    // port + coherent auth pair) AND the from-address. Partial smtp config fails closed.
    it('smtp fully configured + from-address -> deliverable', () => {
      expect(
        emailCapabilityFromEnv({
          SETU_EMAIL_ADAPTER: 'smtp',
          SETU_SMTP_HOST: '127.0.0.1',
          SETU_SMTP_PORT: '1025',
          SETU_FORMS_NOTIFY_FROM: 'noreply@example.com'
        })
      ).toEqual({ transport: 'smtp', deliverable: true })
    })

    it('smtp with no SETU_SMTP_PORT -> deliverable (defaults to 587)', () => {
      expect(
        emailCapabilityFromEnv({
          SETU_EMAIL_ADAPTER: 'smtp',
          SETU_SMTP_HOST: 'smtp.example.com',
          SETU_FORMS_NOTIFY_FROM: 'noreply@example.com'
        })
      ).toEqual({ transport: 'smtp', deliverable: true })
    })

    it('smtp selected but SETU_SMTP_HOST unset -> not deliverable (fail closed)', () => {
      expect(
        emailCapabilityFromEnv({
          SETU_EMAIL_ADAPTER: 'smtp',
          SETU_FORMS_NOTIFY_FROM: 'noreply@example.com'
        })
      ).toEqual({ transport: 'smtp', deliverable: false })
    })

    it('smtp with an invalid SETU_SMTP_PORT -> not deliverable (fail closed)', () => {
      expect(
        emailCapabilityFromEnv({
          SETU_EMAIL_ADAPTER: 'smtp',
          SETU_SMTP_HOST: '127.0.0.1',
          SETU_SMTP_PORT: 'not-a-port',
          SETU_FORMS_NOTIFY_FROM: 'noreply@example.com'
        })
      ).toEqual({ transport: 'smtp', deliverable: false })
    })

    it('smtp configured but no SETU_FORMS_NOTIFY_FROM -> not deliverable (same rule as resend)', () => {
      expect(
        emailCapabilityFromEnv({
          SETU_EMAIL_ADAPTER: 'smtp',
          SETU_SMTP_HOST: '127.0.0.1',
          SETU_SMTP_PORT: '1025'
        })
      ).toEqual({ transport: 'smtp', deliverable: false })
    })

    // #498: settings.json's email.fromAddress joins SETU_FORMS_NOTIFY_FROM as a from-address
    // source. A non-empty settings value wins; the env var is the fallback — the same precedence
    // server.ts applies when it builds the actual messages.
    it('resend + settings from-address (no env) -> deliverable (settings alone satisfy the from requirement)', () => {
      expect(
        emailCapabilityFromEnv(
          { SETU_EMAIL_ADAPTER: 'resend', RESEND_API_KEY: 'test-fake-key' },
          'owner@example.com'
        )
      ).toEqual({ transport: 'resend', deliverable: true })
    })

    it('resend + empty settings value + env set -> deliverable (env is the fallback)', () => {
      expect(
        emailCapabilityFromEnv(
          {
            SETU_EMAIL_ADAPTER: 'resend',
            RESEND_API_KEY: 'test-fake-key',
            SETU_FORMS_NOTIFY_FROM: 'noreply@example.com'
          },
          ''
        )
      ).toEqual({ transport: 'resend', deliverable: true })
    })

    it('console + settings from-address -> still not deliverable (transport gates console, not the from)', () => {
      expect(
        emailCapabilityFromEnv(
          { SETU_EMAIL_ADAPTER: 'console' },
          'owner@example.com'
        )
      ).toEqual({ transport: 'console', deliverable: false })
    })

    // #885 review Finding 2: a resend selection without its API key cannot deliver anything —
    // reporting deliverable:true rendered "Ready to send ✓" directly under "API key: missing ✗".
    it('resend WITHOUT RESEND_API_KEY -> not deliverable, even with a from-address (fail closed, like partial smtp)', () => {
      expect(
        emailCapabilityFromEnv(
          {
            SETU_EMAIL_ADAPTER: 'resend',
            SETU_FORMS_NOTIFY_FROM: 'noreply@example.com'
          },
          'owner@example.com'
        )
      ).toEqual({ transport: 'resend', deliverable: false })
    })

    // #890: the boot snapshot follows the same provider precedence as everything else — a
    // settings-chosen transport must be what /api/capabilities reports, not the env var it
    // overrode.
    it('a settings-chosen provider is the reported transport and counts toward deliverable', () => {
      expect(
        emailCapabilityFromEnv(
          {
            SETU_EMAIL_ADAPTER: 'console',
            SETU_SMTP_HOST: '127.0.0.1',
            SETU_SMTP_PORT: '11025'
          },
          'owner@example.com',
          'smtp'
        )
      ).toEqual({ transport: 'smtp', deliverable: true })
    })

    it('a settings-chosen provider whose secret is missing is reported but NOT deliverable', () => {
      expect(emailCapabilityFromEnv({}, 'owner@example.com', 'resend')).toEqual(
        { transport: 'resend', deliverable: false }
      )
    })
  })

  // #885 review Finding 2: the ONE transport-usability predicate server.ts's adapter selection,
  // emailCapabilityFromEnv and the /api/email/status thunk all share — so "which adapter is
  // actually wired" and "what the admin screen reports" cannot drift.
  describe('usableEmailTransport (shared transport-usability predicate)', () => {
    it('console (or unset) -> effective console, no problem', () => {
      expect(usableEmailTransport({})).toEqual({
        selected: 'console',
        source: 'default',
        effective: 'console',
        problem: null
      })
    })

    it('resend with the API key -> effective resend', () => {
      expect(
        usableEmailTransport({
          SETU_EMAIL_ADAPTER: 'resend',
          RESEND_API_KEY: 'test-fake-key'
        })
      ).toEqual({
        selected: 'resend',
        source: 'env',
        effective: 'resend',
        problem: null
      })
    })

    it('resend WITHOUT the API key -> falls back to console and names the missing variable (never its value)', () => {
      expect(usableEmailTransport({ SETU_EMAIL_ADAPTER: 'resend' })).toEqual({
        selected: 'resend',
        source: 'env',
        effective: 'console',
        problem: 'RESEND_API_KEY is unset'
      })
    })

    it('smtp with a usable config -> effective smtp', () => {
      expect(
        usableEmailTransport({
          SETU_EMAIL_ADAPTER: 'smtp',
          SETU_SMTP_HOST: '127.0.0.1',
          SETU_SMTP_PORT: '1025'
        })
      ).toEqual({
        selected: 'smtp',
        source: 'env',
        effective: 'smtp',
        problem: null
      })
    })

    it('smtp with an unusable config -> console + smtpConfigFromEnv problem string', () => {
      expect(usableEmailTransport({ SETU_EMAIL_ADAPTER: 'smtp' })).toEqual({
        selected: 'smtp',
        source: 'env',
        effective: 'console',
        problem: 'SETU_SMTP_HOST is unset'
      })
    })

    // #942: the env branch had NO allowlist while the settings side is enum-constrained, so a
    // typo fell out here as `problem: null` — and the boot "selected but not usable" error is
    // gated on `problem !== null`, so the operator got no line naming the typo. The fallback is
    // deliberately UNCHANGED (effective stays 'console'): hard-failing boot would break an
    // upgrade for a deployment that currently "works" via the console fallback.
    it('an unrecognized env transport -> console fallback KEPT, with a problem naming the variable and the value', () => {
      const t = usableEmailTransport({ SETU_EMAIL_ADAPTER: 'sendgrid' })
      expect(t.selected).toBe('sendgrid')
      expect(t.source).toBe('env')
      expect(t.effective).toBe('console')
      expect(t.problem).toContain('SETU_EMAIL_ADAPTER')
      expect(t.problem).toContain('sendgrid')
      expect(t.problem).toContain('console, resend or smtp')
    })

    it('a capitalised env transport is unrecognized too (the case #942 opened on)', () => {
      const t = usableEmailTransport({ SETU_EMAIL_ADAPTER: 'Resend' })
      expect(t.effective).toBe('console')
      expect(t.problem).toContain('Resend')
    })

    // Unset and '' are the SILENT default — naming a problem for them would shout at every
    // zero-config boot, which is the normal state.
    it('unset / empty SETU_EMAIL_ADAPTER stays the silent console default', () => {
      expect(usableEmailTransport({}).problem).toBeNull()
      expect(
        usableEmailTransport({ SETU_EMAIL_ADAPTER: '' }).problem
      ).toBeNull()
      expect(
        usableEmailTransport({ SETU_EMAIL_ADAPTER: 'console' }).problem
      ).toBeNull()
    })

    // The settings side cannot normally deliver an unrecognized value (the zod enum resets it
    // with a warning), but settings.json is Git-canonical and the check is at the point of USE,
    // so it names the stored field rather than the env var when settings chose.
    it('an unrecognized settings provider names settings.json, not the env var', () => {
      const t = usableEmailTransport({}, 'sendgrid')
      expect(t.source).toBe('settings')
      expect(t.effective).toBe('console')
      expect(t.problem).toContain('email.provider')
      expect(t.problem).not.toContain('SETU_EMAIL_ADAPTER')
    })

    // #890 fail-safe: a provider STORED in settings.json is exactly as untrustworthy as an env
    // var — settings.json is Git-canonical, so it can arrive by `git push` without ever passing
    // through the api's write gate. The usability check is therefore the real enforcement point:
    // an unusable stored provider must degrade to console with a named reason, never throw and
    // never silently pretend to send.
    it('a settings provider whose secret is missing falls back to console with the reason (fail-safe)', () => {
      expect(usableEmailTransport({}, 'resend')).toEqual({
        selected: 'resend',
        source: 'settings',
        effective: 'console',
        problem: 'RESEND_API_KEY is unset'
      })
      expect(usableEmailTransport({}, 'smtp')).toEqual({
        selected: 'smtp',
        source: 'settings',
        effective: 'console',
        problem: 'SETU_SMTP_HOST is unset'
      })
    })

    it('a usable settings provider is honored even when the env var names a different one', () => {
      expect(
        usableEmailTransport(
          { SETU_EMAIL_ADAPTER: 'console', SETU_SMTP_HOST: '127.0.0.1' },
          'smtp'
        )
      ).toEqual({
        selected: 'smtp',
        source: 'settings',
        effective: 'smtp',
        problem: null
      })
    })
  })

  // #890: the provider CHOICE precedence — settings.json's `email.provider` wins, the
  // SETU_EMAIL_ADAPTER env var is the fallback, console is the zero-config default. Same shape
  // and same discipline as resolveFromAddress below: `source` makes the winner observable (it is
  // served on GET /api/email/status), and the both-set case is the ORDER-SENSITIVE kill-shot —
  // swap the two branches in resolveEmailProvider and it fails.
  describe('resolveEmailProvider (settings win, env fallback, console default)', () => {
    it('BOTH set -> the settings value wins, source is "settings"', () => {
      expect(
        resolveEmailProvider('smtp', { SETU_EMAIL_ADAPTER: 'resend' })
      ).toEqual({ selected: 'smtp', source: 'settings' })
    })

    it('settings empty, env set -> env is the fallback, source is "env"', () => {
      expect(
        resolveEmailProvider('', { SETU_EMAIL_ADAPTER: 'resend' })
      ).toEqual({ selected: 'resend', source: 'env' })
    })

    it('settings set, env unset -> settings alone', () => {
      expect(resolveEmailProvider('resend', {})).toEqual({
        selected: 'resend',
        source: 'settings'
      })
    })

    it('neither -> the console default', () => {
      expect(resolveEmailProvider(undefined, {})).toEqual({
        selected: 'console',
        source: 'default'
      })
    })
  })

  // #890: what the admin's provider dropdown renders. Usability is per-transport and INDEPENDENT
  // of which one is currently selected — the screen has to disable the options it cannot honor
  // and say what to add, which it can't do from the selected transport alone. `problem` is
  // remediation copy naming the env var; like every other string on this surface it never echoes
  // a credential value (asserted below).
  describe('emailTransportOptions (per-transport usability for the picker)', () => {
    it('console is always usable', () => {
      const console_ = emailTransportOptions({}).find((t) => t.id === 'console')
      expect(console_).toEqual({ id: 'console', usable: true, problem: null })
    })

    it('resend: usable only with RESEND_API_KEY, otherwise remediation naming the variable', () => {
      const without = emailTransportOptions({}).find((t) => t.id === 'resend')
      expect(without?.usable).toBe(false)
      expect(without?.problem).toBe(
        'Add RESEND_API_KEY to the server environment to enable Resend.'
      )
      const withKey = emailTransportOptions({
        RESEND_API_KEY: 'test-fake-key'
      }).find((t) => t.id === 'resend')
      expect(withKey).toEqual({ id: 'resend', usable: true, problem: null })
    })

    it('smtp: unset host gets the "add SETU_SMTP_HOST" remediation; a usable config is usable', () => {
      const without = emailTransportOptions({}).find((t) => t.id === 'smtp')
      expect(without?.usable).toBe(false)
      expect(without?.problem).toBe(
        'Add SETU_SMTP_HOST to the server environment to enable SMTP.'
      )
      const withConfig = emailTransportOptions({
        SETU_SMTP_HOST: '127.0.0.1',
        SETU_SMTP_PORT: '11025'
      }).find((t) => t.id === 'smtp')
      expect(withConfig).toEqual({ id: 'smtp', usable: true, problem: null })
    })

    it('smtp misconfigured beyond a missing host: the specific reason, never a credential value', () => {
      const opt = emailTransportOptions({
        SETU_SMTP_HOST: '127.0.0.1',
        SETU_SMTP_USER: 'postmaster',
        SETU_SMTP_PASS: ''
      }).find((t) => t.id === 'smtp')
      expect(opt?.usable).toBe(false)
      expect(opt?.problem).toContain(
        'SETU_SMTP_USER and SETU_SMTP_PASS must be set together'
      )
      expect(opt?.problem).not.toContain('postmaster')
    })

    it('offers exactly the three known transports, console first', () => {
      expect(emailTransportOptions({}).map((t) => t.id)).toEqual([
        'console',
        'resend',
        'smtp'
      ])
    })
  })

  // #885 review Finding 3: precedence must be ORDER-SENSITIVE and observable — a boolean fold
  // can't distinguish "settings win" from "env wins". `source` makes the winner explicit; the
  // both-set case below is the kill-shot target (swap the order in resolveFromAddress and it
  // fails).
  describe('resolveFromAddress (settings win, env fallback)', () => {
    it('BOTH set -> the settings value wins, source is "settings"', () => {
      expect(
        resolveFromAddress('owner@settings.example', {
          SETU_FORMS_NOTIFY_FROM: 'ops@env.example'
        })
      ).toEqual({
        effective: 'owner@settings.example',
        source: 'settings',
        problem: null
      })
    })

    it('settings empty, env set -> env is the fallback, source is "env"', () => {
      expect(
        resolveFromAddress('', { SETU_FORMS_NOTIFY_FROM: 'ops@env.example' })
      ).toEqual({ effective: 'ops@env.example', source: 'env', problem: null })
    })

    it('settings set, env unset -> settings alone', () => {
      expect(resolveFromAddress('owner@settings.example', {})).toEqual({
        effective: 'owner@settings.example',
        source: 'settings',
        problem: null
      })
    })

    it('neither -> null/null', () => {
      expect(resolveFromAddress(undefined, {})).toEqual({
        effective: null,
        source: null,
        problem: null
      })
    })

    // #942: the env branch was never format-checked, so a whitespace-only value satisfied this
    // function's truthiness, then `deliverable`, then the reset gate's `Boolean(p.from)` and the
    // submission gate. It now goes through the SAME z.string().email() the settings field uses.
    it('a whitespace-only SETU_FORMS_NOTIFY_FROM does not resolve — null, with a named problem', () => {
      const r = resolveFromAddress(undefined, {
        SETU_FORMS_NOTIFY_FROM: '   '
      })
      expect(r.effective).toBeNull()
      expect(r.source).toBeNull()
      expect(r.problem).toContain('SETU_FORMS_NOTIFY_FROM')
    })

    it('a malformed SETU_FORMS_NOTIFY_FROM does not resolve, and the problem never echoes the value', () => {
      const r = resolveFromAddress(undefined, {
        SETU_FORMS_NOTIFY_FROM: 'ops-at-env.example'
      })
      expect(r.effective).toBeNull()
      expect(r.problem).toContain('SETU_FORMS_NOTIFY_FROM')
      expect(r.problem).not.toContain('ops-at-env.example')
    })

    // Unset / '' is "not configured", not "misconfigured" — no problem to name.
    it('an unset or empty SETU_FORMS_NOTIFY_FROM is silent, not a problem', () => {
      expect(resolveFromAddress(undefined, {}).problem).toBeNull()
      expect(
        resolveFromAddress(undefined, { SETU_FORMS_NOTIFY_FROM: '' }).problem
      ).toBeNull()
    })

    // #942 review F1: server.ts used to build the status `from` as a named-field literal with a
    // comment claiming that stopped a future spread from widening the response. It does not —
    // excess-property checking does not apply to a variable in a property position, so `from,`
    // typechecks clean and would ship every field of FromAddressResolution to the client. This
    // is the enforcement the comment claimed: the ONE projection the route calls, with its key
    // set pinned, mirroring the unauthenticated-capabilities key pin above.
    it('publicFrom exposes exactly the from-address keys the client is meant to see', () => {
      const r = resolveFromAddress(undefined, {
        SETU_FORMS_NOTIFY_FROM: 'ops-at-env.example'
      })
      expect(Object.keys(publicFrom(r)).sort()).toEqual([
        'effective',
        'problem',
        'source'
      ])
    })

    it('publicFrom carries the three values through unchanged', () => {
      expect(
        publicFrom(
          resolveFromAddress('owner@settings.example', {
            SETU_FORMS_NOTIFY_FROM: 'ops@env.example'
          })
        )
      ).toEqual({
        effective: 'owner@settings.example',
        source: 'settings',
        problem: null
      })
    })

    // The settings value still wins even when the env fallback is malformed — the fallback is
    // only consulted when settings has nothing, so a broken env var can't shadow a good save.
    it('a malformed env value does not disturb a good settings value', () => {
      expect(
        resolveFromAddress('owner@settings.example', {
          SETU_FORMS_NOTIFY_FROM: 'nope'
        })
      ).toEqual({
        effective: 'owner@settings.example',
        source: 'settings',
        problem: null
      })
    })
  })

  describe('smtpConfigFromEnv (#256 — the single parser server.ts and emailCapabilityFromEnv share)', () => {
    it('parses a full config (host, port, secure, auth)', () => {
      expect(
        smtpConfigFromEnv({
          SETU_SMTP_HOST: 'smtp.example.com',
          SETU_SMTP_PORT: '465',
          SETU_SMTP_SECURE: 'true',
          SETU_SMTP_USER: 'u',
          SETU_SMTP_PASS: 'p'
        })
      ).toEqual({
        config: {
          host: 'smtp.example.com',
          port: 465,
          secure: true,
          auth: { user: 'u', pass: 'p' }
        }
      })
    })

    it('auth is omitted (not half-built) when user/pass are unset — Mailpit needs none', () => {
      expect(
        smtpConfigFromEnv({
          SETU_SMTP_HOST: '127.0.0.1',
          SETU_SMTP_PORT: '11025'
        })
      ).toEqual({ config: { host: '127.0.0.1', port: 11025, secure: false } })
    })

    it('defaults the port to 587 (submission) when SETU_SMTP_PORT is unset', () => {
      expect(smtpConfigFromEnv({ SETU_SMTP_HOST: 'smtp.example.com' })).toEqual(
        {
          config: { host: 'smtp.example.com', port: 587, secure: false }
        }
      )
    })

    it('missing host -> problem naming the variable', () => {
      const r = smtpConfigFromEnv({ SETU_SMTP_PORT: '1025' })
      expect(r).toHaveProperty('problem')
      expect((r as { problem: string }).problem).toContain('SETU_SMTP_HOST')
    })

    it('non-numeric / out-of-range port -> problem, never NaN in a config', () => {
      for (const bad of ['abc', '0', '65536', '12.5']) {
        const r = smtpConfigFromEnv({
          SETU_SMTP_HOST: 'h',
          SETU_SMTP_PORT: bad
        })
        expect(r, `port ${JSON.stringify(bad)}`).toHaveProperty('problem')
      }
    })

    it('user without pass (and vice versa) -> problem; the message never echoes the values', () => {
      const r1 = smtpConfigFromEnv({
        SETU_SMTP_HOST: 'h',
        SETU_SMTP_USER: 'only-user-value'
      })
      expect(r1).toHaveProperty('problem')
      expect((r1 as { problem: string }).problem).not.toContain(
        'only-user-value'
      )
      const r2 = smtpConfigFromEnv({
        SETU_SMTP_HOST: 'h',
        SETU_SMTP_PASS: 'secret-pass-value'
      })
      expect(r2).toHaveProperty('problem')
      expect((r2 as { problem: string }).problem).not.toContain(
        'secret-pass-value'
      )
    })

    // #928 — the adapter now sets seconds-scale timeouts instead of inheriting nodemailer's
    // minutes-scale defaults, because the send is awaited inside the PUBLIC /forms/submit
    // request. These are the operator's escape hatch for a genuinely slow relay.
    describe('smtp timeout overrides (#928)', () => {
      it('omits all four when unset — the adapter applies its own bounded defaults', () => {
        expect(smtpConfigFromEnv({ SETU_SMTP_HOST: 'h' })).toEqual({
          config: { host: 'h', port: 587, secure: false }
        })
      })

      it('passes each override through under the adapter option name', () => {
        expect(
          smtpConfigFromEnv({
            SETU_SMTP_HOST: 'h',
            SETU_SMTP_CONNECTION_TIMEOUT_MS: '11000',
            SETU_SMTP_GREETING_TIMEOUT_MS: '12000',
            SETU_SMTP_SOCKET_TIMEOUT_MS: '13000',
            SETU_SMTP_DNS_TIMEOUT_MS: '14000'
          })
        ).toEqual({
          config: {
            host: 'h',
            port: 587,
            secure: false,
            connectionTimeout: 11_000,
            greetingTimeout: 12_000,
            socketTimeout: 13_000,
            dnsTimeout: 14_000
          }
        })
      })

      it('accepts a partial override without disturbing the others', () => {
        expect(
          smtpConfigFromEnv({
            SETU_SMTP_HOST: 'h',
            SETU_SMTP_SOCKET_TIMEOUT_MS: '45000'
          })
        ).toEqual({
          config: { host: 'h', port: 587, secure: false, socketTimeout: 45_000 }
        })
      })

      it('fails closed on a bad value rather than silently restoring the multi-minute default', () => {
        for (const bad of ['abc', '0', '-1', '1.5', '3600001']) {
          const r = smtpConfigFromEnv({
            SETU_SMTP_HOST: 'h',
            SETU_SMTP_SOCKET_TIMEOUT_MS: bad
          })
          expect(r, `socket timeout ${JSON.stringify(bad)}`).toHaveProperty(
            'problem'
          )
          expect((r as { problem: string }).problem).toContain(
            'SETU_SMTP_SOCKET_TIMEOUT_MS'
          )
        }
      })
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
        history: false,
        auth: NO_AUTH,
        email: NO_EMAIL
      })
      const app = createCapabilitiesApi(
        base,
        () =>
          resolveAuthCapabilitiesLike(true, () => {
            throw new Error('disk I/O error')
          }),
        () => NO_EMAIL
      )
      const res = await app.fetch(new Request('http://test/api/capabilities'))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { auth: { needsSetup: boolean } }
      expect(body.auth.needsSetup).toBe(false)
    })
  })
})

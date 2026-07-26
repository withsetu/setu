import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createAuth } from '@setu/auth'
import { resolveSessionActor } from '../src/auth/resolve-session-actor'
import { usableEmailTransport } from '../src/capabilities'
import { createEmailDispatcher } from '../src/email-transport'
import {
  createEmailApi,
  resetRestartRequired,
  type EmailStatus,
  type EmailStatusContext
} from '../src/email'
import type { EmailConfig } from '../src/email-config'

const TRUSTED_ORIGIN = 'http://localhost:5173'

/** #938: the route no longer takes a hand-written `EmailStatus` — it takes the live reading and
 *  builds the payload through `buildEmailStatus`, which is the production function. So these
 *  tests inject a CONFIG and the derived fields (`deliverable`, `transports`, `secrets`,
 *  `resetRestartRequired`) come out of the code under test rather than out of the fixture. The
 *  fixture that used to live here had drifted from production in exactly that gap. */
const STATUS_ENV: NodeJS.ProcessEnv = {
  RESEND_API_KEY: 'test-fake-key'
}

const STATUS_CONTEXT: EmailStatusContext = {
  env: STATUS_ENV,
  mode: 'self-hosted',
  resetWiredAtBoot: true,
  authConfigured: true,
  adminOriginPresent: true
}

/** A live reading the route treats as "resend, fully configured". Tests override members to
 *  model the other states (console, no from-address). */
function resendConfig(over: Partial<EmailConfig> = {}): EmailConfig {
  return {
    from: { effective: 'noreply@example.com', source: 'env', problem: null },
    transport: {
      selected: 'resend',
      source: 'env',
      effective: 'resend',
      problem: null
    },
    templates: {},
    siteTitle: 'Setu',
    ...over
  }
}

/** Same real, temp-file-backed better-auth harness as users-send-reset.test.ts — sessions are
 *  real; the transport is an injected spy so tests assert exactly what the route asked it to
 *  send (and that authz/rate-limit failures never reach it). */
function makeApp(opts: { config?: EmailConfig; sendError?: Error } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'email-api-'))
  const dbFile = join(dir, 'auth.db')
  const sqlite = new Database(dbFile)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })

  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: [TRUSTED_ORIGIN]
  })

  let nowMs = 1_000_000
  const sendSpy = vi.fn(
    async (_msg: {
      to: string
      from: string
      subject: string
      html: string
      text?: string
    }) => {
      if (opts.sendError) throw opts.sendError
    }
  )
  let config = opts.config ?? resendConfig()
  let configReads = 0
  const app = createEmailApi({
    resolveActor: resolveSessionActor(auth),
    resolveConfig: () => {
      configReads += 1
      return config
    },
    statusContext: STATUS_CONTEXT,
    sendVia: (_transport, msg) => sendSpy(msg),
    now: () => nowMs
  })

  return {
    app,
    auth,
    sendSpy,
    configReads: () => configReads,
    setConfig: (c: EmailConfig) => {
      config = c
    },
    advance: (ms: number) => {
      nowMs += ms
    },
    cleanup: () => {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

async function makeUser(
  auth: ReturnType<typeof createAuth>,
  opts: { email: string; name: string; role: string; password?: string }
) {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({
    email: opts.email,
    name: opts.name,
    role: opts.role,
    emailVerified: true
  })
  if (opts.password) {
    const hashed = await ctx.password.hash(opts.password)
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: hashed
    })
  }
  return user
}

async function signInCookie(
  auth: ReturnType<typeof createAuth>,
  email: string,
  password: string
) {
  const res = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true
  })
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

function build(opts: { config?: EmailConfig; sendError?: Error } = {}) {
  const built = makeApp(opts)
  cleanups.push(built.cleanup)
  return built
}

async function signedIn(
  built: ReturnType<typeof build>,
  role: string,
  email = `${role}@test.com`
) {
  await makeUser(built.auth, {
    email,
    name: role,
    role,
    password: 'a-strong-password-12'
  })
  return signInCookie(built.auth, email, 'a-strong-password-12')
}

function statusReq(cookie?: string) {
  return new Request('http://test/api/email/status', {
    headers: cookie ? { cookie } : {}
  })
}

function sendReq(cookie?: string, body?: unknown) {
  return new Request('http://test/api/email/test-send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
}

// #885 review Finding 1: the reset send path is wired once at boot (createAuth's `email:`
// option) — this pure helper is how server.ts decides when to tell the admin "reset will start
// working after a restart": exactly when reset was NOT wired at boot but the live config now has
// everything boot needed.
describe('resetRestartRequired', () => {
  const live = {
    resetWiredAtBoot: false,
    authConfigured: true,
    adminOriginPresent: true,
    liveFrom: 'owner@example.com',
    liveTransportReal: true
  }

  it('true when reset was not wired at boot but a from-address now exists (auth + admin origin present)', () => {
    expect(resetRestartRequired(live)).toBe(true)
  })

  it('false when reset was already wired at boot (nothing to restart for)', () => {
    expect(resetRestartRequired({ ...live, resetWiredAtBoot: true })).toBe(
      false
    )
  })

  it('false when there is still no live from-address (a restart would change nothing)', () => {
    expect(resetRestartRequired({ ...live, liveFrom: null })).toBe(false)
  })

  it('false while the effective transport is still the console adapter (#894)', () => {
    // Reset is gated on a transport that can deliver, so a restart would NOT turn it on — the
    // Settings → Email screen must not promise one.
    expect(resetRestartRequired({ ...live, liveTransportReal: false })).toBe(
      false
    )
  })

  it('false when auth or the admin origin is missing (a restart alone would not enable reset)', () => {
    expect(resetRestartRequired({ ...live, authConfigured: false })).toBe(false)
    expect(resetRestartRequired({ ...live, adminOriginPresent: false })).toBe(
      false
    )
  })
})

describe('GET /api/email/status', () => {
  it('401s with no session', async () => {
    const { app } = build()
    expect((await app.fetch(statusReq())).status).toBe(401)
  })

  it('403s an author (no settings.view)', async () => {
    const built = build()
    const cookie = await signedIn(built, 'author')
    expect((await built.app.fetch(statusReq(cookie))).status).toBe(403)
  })

  it('200s a maintainer (settings.view — the read-only Settings surface) with presence booleans only', async () => {
    const built = build()
    const cookie = await signedIn(built, 'maintainer')
    const res = await built.app.fetch(statusReq(cookie))
    expect(res.status).toBe(200)
    const body = (await res.json()) as EmailStatus
    expect(body.transport).toBe('resend')
    expect(body.secrets).toEqual({
      resendApiKey: true,
      smtpConfigured: false,
      smtpProblem: null
    })
    // Presence-only: the serialized response must never carry key material.
    expect(JSON.stringify(body)).not.toContain('test-fake-key')
  })
})

describe('POST /api/email/test-send', () => {
  it('401s with no session, and no send happens', async () => {
    const { app, sendSpy } = build()
    expect((await app.fetch(sendReq())).status).toBe(401)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('wrong actor: an editor (no settings.manage) gets 403 and no send happens', async () => {
    const built = build()
    const cookie = await signedIn(built, 'editor')
    expect((await built.app.fetch(sendReq(cookie))).status).toBe(403)
    expect(built.sendSpy).not.toHaveBeenCalled()
  })

  it('wrong actor: a maintainer (settings.view but NOT settings.manage — same gate as settings writes) gets 403', async () => {
    const built = build()
    const cookie = await signedIn(built, 'maintainer')
    expect((await built.app.fetch(sendReq(cookie))).status).toBe(403)
    expect(built.sendSpy).not.toHaveBeenCalled()
  })

  it('409s honestly when no from-address is resolvable (settings empty, env unset)', async () => {
    const built = build({
      config: resendConfig({
        from: { effective: null, source: null, problem: null }
      })
    })
    const cookie = await signedIn(built, 'admin')
    const res = await built.app.fetch(sendReq(cookie))
    expect(res.status).toBe(409)
    expect(built.sendSpy).not.toHaveBeenCalled()
  })

  it('happy path: admin gets 200 {result:"sent"}, and the message goes to the ACTOR own address from the configured from', async () => {
    const built = build()
    const cookie = await signedIn(built, 'admin', 'owner@test.com')
    const res = await built.app.fetch(sendReq(cookie))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      result: 'sent',
      transport: 'resend',
      to: 'owner@test.com'
    })
    expect(built.sendSpy).toHaveBeenCalledTimes(1)
    const msg = built.sendSpy.mock.calls[0]![0]
    expect(msg.to).toBe('owner@test.com')
    expect(msg.from).toBe('noreply@example.com')
    expect(msg.subject.toLowerCase()).toContain('test')
  })

  it('spam-relay guard: a request body naming another recipient is ignored — the send still goes to the actor', async () => {
    const built = build()
    const cookie = await signedIn(built, 'admin', 'owner@test.com')
    const res = await built.app.fetch(
      sendReq(cookie, {
        to: 'victim@evil.example',
        recipient: 'x@evil.example'
      })
    )
    expect(res.status).toBe(200)
    const msg = built.sendSpy.mock.calls[0]![0]
    expect(msg.to).toBe('owner@test.com')
    expect(JSON.stringify(msg)).not.toContain('evil.example')
  })

  it('console transport: 200 {result:"logged"} — honest "logged, not sent"', async () => {
    const built = build({
      config: resendConfig({
        from: {
          effective: 'owner@example.com',
          source: 'settings',
          problem: null
        },
        transport: {
          selected: 'console',
          source: 'default',
          effective: 'console',
          problem: null
        }
      })
    })
    const cookie = await signedIn(built, 'admin')
    const res = await built.app.fetch(sendReq(cookie))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: string; transport: string }
    expect(body.result).toBe('logged')
    expect(body.transport).toBe('console')
    expect(built.sendSpy).toHaveBeenCalledTimes(1)
  })

  it('rate limit: the 4th send inside a minute is 429 and does NOT reach the transport; a new window admits again', async () => {
    const built = build()
    const cookie = await signedIn(built, 'admin')
    for (let i = 0; i < 3; i += 1) {
      expect((await built.app.fetch(sendReq(cookie))).status).toBe(200)
    }
    const limited = await built.app.fetch(sendReq(cookie))
    expect(limited.status).toBe(429)
    expect(built.sendSpy).toHaveBeenCalledTimes(3)

    built.advance(61_000)
    expect((await built.app.fetch(sendReq(cookie))).status).toBe(200)
    expect(built.sendSpy).toHaveBeenCalledTimes(4)
  })

  it('a transport failure surfaces as 502 failed-with-reason, never a fake success', async () => {
    const built = build({
      sendError: new Error('connect ECONNREFUSED 127.0.0.1:587')
    })
    const cookie = await signedIn(built, 'admin')
    const res = await built.app.fetch(sendReq(cookie))
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string; reason?: string }
    expect(body.error).toBe('send_failed')
    expect(body.reason).toContain('ECONNREFUSED')
  })
})

// #890: the two seams composed exactly the way apps/api/src/server.ts composes them — a live
// email transport whose provider getter re-reads settings, feeding BOTH `send` and the
// transport half of `status`. The unit tests above inject `send` directly, so they can't show
// the thing the owner actually asked for: that choosing a provider in the admin changes where
// a test email goes, with no api restart.
describe('test-send goes through the SETTINGS-chosen transport (live, no restart)', () => {
  function makeLiveApp(env: NodeJS.ProcessEnv) {
    const dir = mkdtempSync(join(tmpdir(), 'email-live-'))
    const dbFile = join(dir, 'auth.db')
    const sqlite = new Database(dbFile)
    const db = drizzle(sqlite)
    migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })
    const auth = createAuth({
      db,
      secret: 'test-secret-32-chars-minimum!!!!',
      baseURL: 'http://localhost:4444',
      trustedOrigins: [TRUSTED_ORIGIN]
    })

    // Stands in for settings.json's `email.provider`; server.ts re-reads the file here.
    let provider = ''
    // #919: when set, `provider()` answers `first` on its next read and `then` on every read
    // after — a settings.json rewrite landing mid-request, which is what makes a route that
    // reads twice disagree with itself.
    let flip: { first: string; then: string; used: boolean } | null = null
    const readProvider = () => {
      if (!flip) return provider
      if (!flip.used) {
        flip.used = true
        return flip.first
      }
      return flip.then
    }
    const delivered: { kind: string; to: string; text: string }[] = []
    const adapter = (kind: string) => ({
      send: async (msg: { to: string; text?: string }) => {
        delivered.push({ kind, to: msg.to, text: msg.text ?? '' })
      }
    })
    const email = createEmailDispatcher({
      env,
      adapters: {
        console: () => adapter('console'),
        resend: () => adapter('resend'),
        smtp: () => adapter('smtp')
      }
    })

    // #938: this used to hand-write an `EmailStatus` here, and its `deliverable` had dropped the
    // `&& from.effective !== null` half that production carried — the third of three copies of
    // one predicate. It now resolves a config exactly as server.ts does and lets the route build
    // the payload through `buildEmailStatus`, so there is no copy left to drift.
    // #939: `resolveConfig` is also the ONLY settings-shaped read the route makes. `configReads`
    // is what keeps the flip test below non-vacuous now that self-consistency is structural.
    let configReads = 0
    const app = createEmailApi({
      resolveActor: resolveSessionActor(auth),
      resolveConfig: () => {
        configReads += 1
        return {
          from: {
            effective: 'noreply@example.com',
            source: 'env',
            problem: null
          },
          // #959: the route's config is where selection happens now — the same
          // `usableEmailTransport` call `resolveEmailConfig` makes, over the flipping provider.
          transport: usableEmailTransport(env, readProvider()),
          templates: {},
          siteTitle: 'Setu'
        }
      },
      statusContext: {
        env,
        mode: 'self-hosted',
        resetWiredAtBoot: true,
        authConfigured: true,
        adminOriginPresent: true
      },
      sendVia: (transport, msg) => email.sendVia(transport, msg)
    })

    cleanups.push(() => {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    })
    return {
      app,
      auth,
      delivered,
      configReads: () => configReads,
      setProvider: (p: string) => {
        provider = p
      },
      flipProviderAfterFirstRead: (first: string, then: string) => {
        flip = { first, then, used: false }
      }
    }
  }

  const SMTP_ENV = {
    SETU_EMAIL_ADAPTER: 'console',
    SETU_SMTP_HOST: '127.0.0.1',
    SETU_SMTP_PORT: '11025'
  }

  it('switching the stored provider between two sends changes the transport — the app is never rebuilt', async () => {
    const live = makeLiveApp(SMTP_ENV)
    await makeUser(live.auth, {
      email: 'admin@test.com',
      name: 'admin',
      role: 'admin',
      password: 'a-strong-password-12'
    })
    const cookie = await signInCookie(
      live.auth,
      'admin@test.com',
      'a-strong-password-12'
    )

    const first = await live.app.fetch(sendReq(cookie))
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({
      result: 'logged',
      transport: 'console'
    })

    live.setProvider('smtp') // == the admin saving Settings → Email

    const status = (await (
      await live.app.fetch(statusReq(cookie))
    ).json()) as EmailStatus
    expect(status).toMatchObject({
      transport: 'smtp',
      providerSource: 'settings',
      effectiveTransport: 'smtp'
    })

    const second = await live.app.fetch(sendReq(cookie))
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({
      result: 'sent',
      transport: 'smtp'
    })
    expect(live.delivered.map((d) => d.kind)).toEqual(['console', 'smtp'])
  })

  // The §4 #13 fail-safe, end to end: settings.json is Git-canonical, so an unusable provider
  // can land there without ever passing the api's settings-write gate. The send must still
  // succeed honestly (console, "logged") rather than 502 on an adapter that cannot work — and
  // the status must SAY so instead of reporting a transport that isn't sending.
  it('a stored provider whose secret is absent degrades to console and is reported honestly', async () => {
    const live = makeLiveApp({ SETU_EMAIL_ADAPTER: 'console' })
    live.setProvider('resend') // no RESEND_API_KEY in this env
    await makeUser(live.auth, {
      email: 'admin@test.com',
      name: 'admin',
      role: 'admin',
      password: 'a-strong-password-12'
    })
    const cookie = await signInCookie(
      live.auth,
      'admin@test.com',
      'a-strong-password-12'
    )

    const status = (await (
      await live.app.fetch(statusReq(cookie))
    ).json()) as EmailStatus
    expect(status.transport).toBe('resend')
    expect(status.effectiveTransport).toBe('console')
    expect(status.deliverable).toBe(false)
    expect(status.transports.find((t) => t.id === 'resend')).toMatchObject({
      usable: false,
      problem: 'Add RESEND_API_KEY to the server environment to enable Resend.'
    })

    const res = await live.app.fetch(sendReq(cookie))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      result: 'logged',
      transport: 'console'
    })
    expect(live.delivered.map((d) => d.kind)).toEqual(['console'])
  })

  /**
   * #919, the test-send half. The route used to label the outcome and stamp `Transport: …` into
   * the body from `opts.status()`'s reading, then dispatch through an `opts.send` that resolved
   * AGAIN — so a settings.json rewrite landing between the two made the admin screen say "sent"
   * over a message the console adapter had merely logged. That is precisely the lie the
   * `result: 'logged' | 'sent'` distinction exists to prevent (card #7's saved≠live cousin).
   *
   * The provider stub answers 'smtp' on the first read and 'console' on every read after, so a
   * route that reads twice cannot help but disagree with itself.
   *
   * #939 made "one reading" structural — the handler resolves a single `EmailConfig` and gates,
   * stamps, dispatches and labels from it — which would leave the agreement assertions below
   * VACUOUSLY true (there is no second reading left to disagree with). The read count is
   * therefore asserted too: it is what fails if a second resolution is ever reintroduced, and it
   * is the assertion that carries this test's claim now.
   */
  it('labels the outcome from the reading it actually dispatched through, even when the provider flips mid-request (#919)', async () => {
    const live = makeLiveApp(SMTP_ENV)
    await makeUser(live.auth, {
      email: 'admin@test.com',
      name: 'admin',
      role: 'admin',
      password: 'a-strong-password-12'
    })
    const cookie = await signInCookie(
      live.auth,
      'admin@test.com',
      'a-strong-password-12'
    )

    live.flipProviderAfterFirstRead('smtp', 'console')

    const res = await live.app.fetch(sendReq(cookie))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: string; transport: string }

    // Whichever reading won, the label and the adapter that actually sent must be the SAME one.
    const dispatched = live.delivered.at(-1)!.kind
    expect(body.transport).toBe(dispatched)
    expect(body.result).toBe(dispatched === 'console' ? 'logged' : 'sent')
    // And the body's own `Transport:` stamp must not contradict it either.
    expect(live.delivered.at(-1)!.text).toContain(`Transport: ${dispatched}`)
    // The load-bearing assertion since #939: ONE reading for the whole POST. Everything above
    // follows from it, and this is what a reintroduced second resolution would break.
    expect(live.configReads()).toBe(1)
    // Corroboration that the flip stub was armed and would have been observable: the second
    // reading, had one happened, would have answered 'console' rather than 'smtp'.
    expect(dispatched).toBe('smtp')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createAuth } from '@setu/auth'
import { resolveSessionActor } from '../src/auth/resolve-session-actor'
import {
  createEmailApi,
  resetRestartRequired,
  type EmailStatus
} from '../src/email'

const TRUSTED_ORIGIN = 'http://localhost:5173'

/** A status snapshot the route treats as "resend, fully configured". Tests override
 *  fields to model the other states (console, no from-address, smtp problem). */
function resendStatus(over: Partial<EmailStatus> = {}): EmailStatus {
  return {
    transport: 'resend',
    effectiveTransport: 'resend',
    deliverable: true,
    mode: 'self-hosted',
    from: { effective: 'noreply@example.com', source: 'env' },
    secrets: { resendApiKey: true, smtpConfigured: false, smtpProblem: null },
    resetRestartRequired: false,
    ...over
  }
}

/** Same real, temp-file-backed better-auth harness as users-send-reset.test.ts — sessions are
 *  real; the transport is an injected spy so tests assert exactly what the route asked it to
 *  send (and that authz/rate-limit failures never reach it). */
function makeApp(opts: { status?: EmailStatus; sendError?: Error } = {}) {
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
  let status = opts.status ?? resendStatus()
  const app = createEmailApi({
    resolveActor: resolveSessionActor(auth),
    status: () => status,
    send: sendSpy,
    now: () => nowMs
  })

  return {
    app,
    auth,
    sendSpy,
    setStatus: (s: EmailStatus) => {
      status = s
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

function build(opts: { status?: EmailStatus; sendError?: Error } = {}) {
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
    liveFrom: 'owner@example.com'
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
      status: resendStatus({
        deliverable: false,
        from: { effective: null, source: null }
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
      status: resendStatus({
        transport: 'console',
        effectiveTransport: 'console',
        deliverable: false,
        from: { effective: 'owner@example.com', source: 'settings' },
        secrets: {
          resendApiKey: false,
          smtpConfigured: false,
          smtpProblem: null
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

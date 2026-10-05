import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createAuth, PROVISIONING } from '@setu/auth'
import type { EmailMessage } from '@setu/core'
import type { UsableEmailTransport } from '../src/capabilities'
import type { EmailConfig } from '../src/email-config'
import { createResetEmailGate } from '../src/reset-email-gate'
import { resolveSessionActor } from '../src/auth/resolve-session-actor'
import { createUsersApi } from '../src/users'

/**
 * #1164: the admin "send password reset" action used to report "sent" when the email transport
 * threw, because better-auth 1.7.3 runs the send hook through `runInBackgroundOrAwait`, which
 * catches and only logs (dist/api/routes/password.mjs line 82, dist/context/create-context.mjs
 * lines 215-225). Everything here is REAL — better-auth, its reset route, the reset gate and the
 * users route, wired the way apps/api/src/server.ts wires them — except the transport, which is
 * the thing under test: it either records the message or throws like an SMTP server that is down.
 */
const ADMIN_ORIGIN = 'http://localhost:5173'
const FROM = 'site@example.test'
const PASSWORD = 'a-strong-password-12'

const reading = (
  effective: UsableEmailTransport['effective']
): UsableEmailTransport => ({
  selected: effective,
  source: 'env',
  effective,
  problem: null
})

const liveConfig = (): EmailConfig => ({
  from: { effective: FROM, source: 'settings', problem: null },
  transport: reading('smtp'),
  templates: undefined,
  siteTitle: 'Setu'
})

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
  vi.restoreAllMocks()
})

function harness(transport: 'working' | 'failing') {
  const dir = mkdtempSync(join(tmpdir(), 'reset-outcome-'))
  const sqlite = new Database(join(dir, 'auth.db'))
  cleanups.push(() => {
    sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })

  const delivered: EmailMessage[] = []
  const failures: unknown[] = []
  const gate = createResetEmailGate({
    resolveConfig: liveConfig,
    bootFrom: FROM,
    adminOrigin: ADMIN_ORIGIN,
    sendVia: async (_t, msg) => {
      if (transport === 'failing')
        throw new Error('connect ECONNREFUSED 127.0.0.1:587')
      delivered.push(msg)
    },
    onRefused: () => {
      throw new Error('nothing in this harness should be refused')
    },
    onSendFailed: (error) => failures.push(error)
  })

  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: [ADMIN_ORIGIN],
    rateLimit: { enabled: false },
    email: {
      sendReset: gate.sendReset,
      resetRedirectTo: `${ADMIN_ORIGIN}/reset-password`
    }
  })

  // Exactly server.ts's users-api wiring (#1164).
  const app = createUsersApi({
    db,
    resolveActor: resolveSessionActor(auth),
    requestPasswordReset: (email) =>
      gate.observe(() => auth.api.requestPasswordReset({ body: { email } })),
    resetEmailRefusal: gate.refusal
  })

  return { auth, app, gate, delivered, failures }
}

async function makeUser(
  auth: ReturnType<typeof createAuth>,
  email: string,
  role: string,
  password?: string
) {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser(
    { email, name: email.split('@')[0]!, role, emailVerified: true },
    PROVISIONING.adminInvite
  )
  if (password) {
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await ctx.password.hash(password)
    })
  }
  return user
}

async function adminCookie(auth: ReturnType<typeof createAuth>) {
  await makeUser(auth, 'owner@example.test', 'admin', PASSWORD)
  const res = await auth.api.signInEmail({
    body: { email: 'owner@example.test', password: PASSWORD },
    asResponse: true
  })
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

function sendReset(userId: string, cookie: string) {
  return new Request('http://test/api/users/send-reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ userId })
  })
}

describe('POST /api/users/send-reset reports the REAL send outcome (#1164)', () => {
  it('answers 502 email_send_failed — not "sent" — when the transport throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = harness('failing')
    const cookie = await adminCookie(h.auth)
    const target = await makeUser(h.auth, 'target@example.test', 'author')

    const res = await h.app.fetch(sendReset(target.id, cookie))

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body).toEqual({ error: 'email_send_failed' })
    // The transport's own error text is operator detail and stays server-side.
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED')
    // ...where it was reported, through the gate's failure sink (server.ts: log + audit event).
    expect(h.failures).toHaveLength(1)
    expect(String(h.failures[0])).toContain('ECONNREFUSED')
  })

  it('still answers 200 when the transport delivers', async () => {
    const h = harness('working')
    const cookie = await adminCookie(h.auth)
    const target = await makeUser(h.auth, 'target@example.test', 'author')

    const res = await h.app.fetch(sendReset(target.id, cookie))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: true })
    expect(h.delivered.map((m) => m.to)).toEqual(['target@example.test'])
    expect(h.failures).toEqual([])
  })
})

describe('gate.observe (#1164)', () => {
  it('is null when no send ran inside it', async () => {
    const h = harness('working')
    expect(await h.gate.observe(async () => {})).toBeNull()
  })

  it('answers the send that ran in ITS scope, not a concurrent one', async () => {
    // A public forgot-password finishing DURING the admin's request must not be attributed to it —
    // the reason the outcome is scoped rather than shared or keyed by recipient. Shaped as the
    // dangerous direction: the admin's send fails, a concurrent public send then succeeds, and
    // an unscoped record would turn the admin's answer into "sent".
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const gate = createResetEmailGate({
      resolveConfig: liveConfig,
      bootFrom: FROM,
      adminOrigin: ADMIN_ORIGIN,
      sendVia: async (_t, msg) => {
        if (msg.to === 'admin-target@example.test') {
          await sleep(5)
          throw new Error('down')
        }
        await sleep(15)
      },
      onRefused: () => {},
      onSendFailed: () => {}
    })
    const req = (to: string) => ({
      to,
      url: 'https://x.test/r',
      userName: 'A',
      defaultContent: () => ({ subject: 's', html: 'h', text: 't' })
    })
    const observed = gate.observe(async () => {
      await gate.sendReset(req('admin-target@example.test'))
      await sleep(30) // better-auth's work after the hook; the public send lands in here
    })
    const unobserved = gate.sendReset(req('someone-else@example.test'))
    const [outcome] = await Promise.all([observed, unobserved])
    expect(outcome).toEqual({ kind: 'failed' })
  })
})

describe('the PUBLIC forgot-password response is unchanged by a transport failure (#1164)', () => {
  // Anti-enumeration: an unauthenticated caller must not learn whether an address has an account,
  // nor whether sending to it failed. better-auth answers a uniform 200 for an unknown address
  // (dist/api/routes/password.mjs lines 60-71); a failing send must answer the very same thing.
  async function publicRequest(
    auth: ReturnType<typeof createAuth>,
    email: string
  ) {
    const res = await auth.handler(
      new Request('http://localhost:4444/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ADMIN_ORIGIN },
        body: JSON.stringify({ email })
      })
    )
    return { status: res.status, body: await res.text() }
  }

  it('answers an existing address whose send FAILED exactly as it answers an unknown one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = harness('failing')
    await makeUser(h.auth, 'target@example.test', 'author')

    const failed = await publicRequest(h.auth, 'target@example.test')
    const unknown = await publicRequest(h.auth, 'nobody@example.test')

    expect(failed.status).toBe(200)
    expect(failed).toEqual(unknown)
    // The failure was still reported — server-side, through the audit sink.
    expect(h.failures).toHaveLength(1)
  })

  it('answers a delivered send the same way too', async () => {
    const h = harness('working')
    await makeUser(h.auth, 'target@example.test', 'author')

    const sent = await publicRequest(h.auth, 'target@example.test')
    const unknown = await publicRequest(h.auth, 'nobody@example.test')

    expect(sent).toEqual(unknown)
    expect(h.delivered).toHaveLength(1)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createAuth } from '@setu/auth'
import { createConsoleEmailAdapter } from '@setu/email-console'
import type { EmailMessage } from '@setu/core'
import type { UsableEmailTransport } from '../src/capabilities'
import {
  createResetEmailSender,
  resetEmailEnabled
} from '../src/reset-email-gate'

/** #894 end-to-end: the REAL better-auth reset flow, the REAL console adapter, and a REAL
 *  generated token — so the assertions cannot be vacuous the way a hand-written fake token or a
 *  logger that never sees the payload would be. `tee` keeps an un-redacted copy of every message
 *  the transport was handed, which is how the test learns the actual token to search the log for.
 *
 *  Mirrors server.ts's wiring exactly: `email:` is present only when `resetEmailEnabled` says so,
 *  and its `send` is `createResetEmailSender`. */
const ADMIN_ORIGIN = 'http://localhost:5173'
const FROM = 'site@example.test'
const USER_EMAIL = 'target@example.test'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

function harness(effectiveTransport: UsableEmailTransport['effective']) {
  const dir = mkdtempSync(join(tmpdir(), 'reset-leak-'))
  const sqlite = new Database(join(dir, 'auth.db'))
  cleanups.push(() => {
    sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })

  // What the server's stdout would show. The console adapter is the transport in EVERY case
  // here, including the 'resend' one — that is deliberate: it means the deliverable-direction
  // test still proves the adapter itself cannot print a token.
  const logged: string[] = []
  const consoleAdapter = createConsoleEmailAdapter((line) => logged.push(line))
  const tee: EmailMessage[] = []
  const refusals: string[] = []

  const enabled = resetEmailEnabled({
    from: FROM,
    adminOrigin: ADMIN_ORIGIN,
    effectiveTransport
  })

  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: [ADMIN_ORIGIN],
    rateLimit: { enabled: false },
    ...(enabled
      ? {
          email: {
            send: createResetEmailSender({
              send: async (msg) => {
                tee.push(msg)
                await consoleAdapter.send(msg)
              },
              resolveTransport: () => effectiveTransport,
              resolveFrom: () => FROM,
              adminOrigin: ADMIN_ORIGIN,
              onRefused: (reason) => refusals.push(reason)
            }),
            from: FROM,
            resetRedirectTo: `${ADMIN_ORIGIN}/reset-password`
          }
        }
      : {})
  })

  return { auth, db, logged, tee, refusals, enabled }
}

async function makeUser(auth: ReturnType<typeof createAuth>) {
  const ctx = await auth.$context
  await ctx.internalAdapter.createUser({
    email: USER_EMAIL,
    name: 'Target',
    role: 'admin',
    emailVerified: true
  })
}

/** The token better-auth put in the link, read out of the un-redacted copy. */
function tokenOf(msg: EmailMessage): string {
  const match = /reset-password\/([A-Za-z0-9_-]+)/.exec(msg.text ?? '')
  expect(
    match,
    'the reset email should carry a /reset-password/<token> link'
  ).not.toBeNull()
  const token = match![1]!
  // Guard against asserting on something too short to be a credential (a 1-char "token" would
  // make every "log does not contain it" assertion trivially unreliable).
  expect(token.length).toBeGreaterThanOrEqual(16)
  return token
}

describe('password reset never writes a token to the console transport (#894)', () => {
  it('is DISABLED when the effective transport is the console adapter, and logs nothing', async () => {
    const h = harness('console')
    expect(h.enabled).toBe(false)
    await makeUser(h.auth)

    const res = await h.auth.api.requestPasswordReset({
      body: { email: USER_EMAIL, redirectTo: `${ADMIN_ORIGIN}/reset-password` },
      asResponse: true
    })

    // better-auth's own gate: no `sendResetPassword` callback => RESET_PASSWORD_DISABLED.
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain(
      'RESET_PASSWORD_DISABLED'
    )
    // Nothing was minted and nothing was printed.
    expect(h.tee).toEqual([])
    expect(h.logged).toEqual([])
  })

  it('still sends normally when the transport is deliverable', async () => {
    const h = harness('resend')
    expect(h.enabled).toBe(true)
    await makeUser(h.auth)

    const res = await h.auth.api.requestPasswordReset({
      body: { email: USER_EMAIL, redirectTo: `${ADMIN_ORIGIN}/reset-password` },
      asResponse: true
    })

    expect(res.status).toBe(200)
    expect(h.refusals).toEqual([])
    expect(h.tee).toHaveLength(1)
    const msg = h.tee[0]!
    expect(msg.to).toBe(USER_EMAIL)
    expect(msg.from).toBe(FROM)
    // The real message still carries a usable link — the fix must not break the feature.
    expect(msg.text).toContain(`/reset-password/${tokenOf(msg)}`)
  })

  it('redacts the REAL token when a deliverable send lands on the console adapter anyway', async () => {
    // Defence in depth: the transport claims to be 'resend' (so the gate is open) while the
    // adapter behind it is the console one. That is the shape any future re-wiring would take.
    const h = harness('resend')
    await makeUser(h.auth)

    await h.auth.api.requestPasswordReset({
      body: { email: USER_EMAIL, redirectTo: `${ADMIN_ORIGIN}/reset-password` },
      asResponse: true
    })

    const token = tokenOf(h.tee[0]!)
    expect(h.logged).toHaveLength(1)
    expect(h.logged[0]).not.toContain(token)
    expect(h.logged[0]).not.toContain(encodeURIComponent(token))
    // Still a useful dev log line: who it went to, and that it was a reset.
    expect(h.logged[0]).toContain(USER_EMAIL)
    expect(h.logged[0]).toContain('Reset your Setu password')
  })

  it('refuses at SEND time when the live transport drifts to console after boot', async () => {
    // The gate is boot-time; the provider is live (#890). Simulate the drift by flipping the
    // resolver after the auth instance is built.
    const dir = mkdtempSync(join(tmpdir(), 'reset-leak-drift-'))
    const sqlite = new Database(join(dir, 'auth.db'))
    cleanups.push(() => {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    })
    const db = drizzle(sqlite)
    migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })

    let live: UsableEmailTransport['effective'] = 'resend'
    const logged: string[] = []
    const consoleAdapter = createConsoleEmailAdapter((l) => logged.push(l))
    const onRefused = vi.fn()

    const auth = createAuth({
      db,
      secret: 'test-secret-32-chars-minimum!!!!',
      baseURL: 'http://localhost:4444',
      trustedOrigins: [ADMIN_ORIGIN],
      rateLimit: { enabled: false },
      email: {
        send: createResetEmailSender({
          send: (msg) => consoleAdapter.send(msg),
          resolveTransport: () => live,
          resolveFrom: () => FROM,
          adminOrigin: ADMIN_ORIGIN,
          onRefused
        }),
        from: FROM,
        resetRedirectTo: `${ADMIN_ORIGIN}/reset-password`
      }
    })
    await makeUser(auth)

    live = 'console'
    const res = await auth.api.requestPasswordReset({
      body: { email: USER_EMAIL, redirectTo: `${ADMIN_ORIGIN}/reset-password` },
      asResponse: true
    })

    // Enumeration-uniform response is preserved; nothing reached the log.
    expect(res.status).toBe(200)
    expect(logged).toEqual([])
    expect(onRefused).toHaveBeenCalledTimes(1)
  })
})

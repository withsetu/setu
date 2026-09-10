import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { countUsers } from '@setu/db-sqlite'
import type { UserProvisioningSource } from '@better-auth/core'
import { createAuth, ensureLocalOwner, PROVISIONING } from '../src'

/**
 * better-auth 1.7 made `internalAdapter.createUser` take a second, REQUIRED argument saying how
 * the user was provisioned, and feeds it to the `user.validateUserInfo` gate. The type only
 * forces *an* argument; nothing stops a path from declaring something untrue, and an untrue
 * declaration is a false statement inside an auth gate. These tests assert the value each
 * server-side creation path actually hands over.
 *
 * Setu does not install `validateUserInfo` (decision recorded on #1080), so the declaration is
 * captured by wrapping `internalAdapter.createUser` on the resolved context — the same object the
 * plugin routes call through.
 */
function makeAuth(opts?: { serverSetup?: boolean }) {
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })
  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173'],
    ...(opts?.serverSetup
      ? {
          serverSetup: {
            getSetupToken: () => 'test-setup-token-xyz789',
            countUsers: () => countUsers(db)
          }
        }
      : {})
  })
  return { db, auth }
}

/** Records every `source` passed to createUser, and still performs the real creation — so a test
 *  that captures nothing fails on the empty array rather than passing vacuously. */
async function captureSources(auth: ReturnType<typeof createAuth>) {
  const ctx = await auth.$context
  const adapter = ctx.internalAdapter as unknown as {
    createUser: (u: unknown, s: UserProvisioningSource) => Promise<unknown>
  }
  const real = adapter.createUser.bind(adapter)
  const sources: UserProvisioningSource[] = []
  adapter.createUser = (u, s) => {
    sources.push(s)
    return real(u, s)
  }
  return sources
}

describe('provisioning source declared at each createUser path', () => {
  it('ensureLocalOwner declares the loopback local-owner origin, not email-password', async () => {
    const { auth } = makeAuth()
    const sources = await captureSources(auth)

    await ensureLocalOwner(auth, {
      email: 'owner@localhost',
      name: 'Local Owner'
    })

    expect(sources).toEqual([PROVISIONING.localOwner])
    // The local owner is created with NO credential account at all (no linkAccount follow-up), so
    // claiming "email-password" here would describe a password that does not exist.
    expect(sources[0]?.method).not.toBe('email-password')
  })

  it('the first-run setup route declares email-password, because that is what it took', async () => {
    const { auth } = makeAuth({ serverSetup: true })
    const sources = await captureSources(auth)

    const res = await auth.handler(
      new Request('http://localhost:4444/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@example.com',
          password: 'a-strong-password-12',
          name: 'Owner Person',
          token: 'test-setup-token-xyz789'
        })
      })
    )
    expect(res.status).toBe(200)

    expect(sources).toEqual([PROVISIONING.serverSetup])
    expect(sources[0]?.method).toBe('email-password')
  })

  it('no two creation paths claim the same origin', () => {
    const methods = Object.values(PROVISIONING).map((s) => s.method)
    expect(new Set(methods).size).toBe(methods.length)
  })
})

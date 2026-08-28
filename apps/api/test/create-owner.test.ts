import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSqliteDb } from '@setu/db-sqlite'
import { createAuth, type AuthEvent } from '@setu/auth'
import { createOwner } from '../src/scripts/create-owner'

const PASSWORD = 'a-first-owner-password-123'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

/** A real, temp-file-backed auth DB — the same fixture shape reset-password.test.ts uses, and a
 *  real file rather than :memory: because the script opens the file the server opened. */
function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'create-owner-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const dbFile = join(dir, 'submissions.db')
  const db = openSqliteDb(dbFile)
  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173'],
    rateLimit: { enabled: false }
  })
  return { dir, dbFile, auth }
}

async function signInStatus(
  auth: ReturnType<typeof createAuth>,
  email: string,
  password: string
): Promise<number> {
  const res = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true
  })
  return res.status
}

describe('createOwner', () => {
  // The deadlock this command exists to break (#1053): a proxied install can never complete the
  // loopback handshake, so `user` is empty and NOTHING can create the first account.
  it('creates an admin on an EMPTY database that the running api then signs in', async () => {
    const { dbFile, auth } = makeDb()
    const ctx = await auth.$context
    expect(await ctx.internalAdapter.findUserByEmail('owner@test.com')).toBe(
      null
    )

    const result = await createOwner({
      dbFile,
      email: 'owner@test.com',
      password: PASSWORD
    })

    expect(result.userId).toBeTruthy()
    expect(result.role).toBe('admin')
    expect(await signInStatus(auth, 'owner@test.com', PASSWORD)).toBe(200)
  })

  it('creates the user at admin rank, not the default role', async () => {
    const { dbFile, auth } = makeDb()
    await createOwner({ dbFile, email: 'owner@test.com', password: PASSWORD })
    const ctx = await auth.$context
    const found = await ctx.internalAdapter.findUserByEmail('owner@test.com')
    expect((found?.user as { role?: string } | undefined)?.role).toBe('admin')
  })

  // Idempotency is a REFUSAL, not a silent upsert: silently resetting an existing admin's
  // password would make this command a way to take over an account rather than bootstrap one.
  it('refuses an email that already exists and points at reset-password', async () => {
    const { dbFile } = makeDb()
    await createOwner({ dbFile, email: 'owner@test.com', password: PASSWORD })

    await expect(
      createOwner({
        dbFile,
        email: 'owner@test.com',
        password: 'a-different-password-456'
      })
    ).rejects.toThrow(/already exists[\s\S]*auth:reset-password/)
  })

  it('rejects a too-short password before creating anything', async () => {
    const { dbFile, auth } = makeDb()
    await expect(
      createOwner({ dbFile, email: 'owner@test.com', password: 'short' })
    ).rejects.toThrow(/at least 8/)

    // The critical half: no half-created passwordless user left behind.
    const ctx = await auth.$context
    expect(await ctx.internalAdapter.findUserByEmail('owner@test.com')).toBe(
      null
    )
  })

  // openSqliteDb would happily create-and-migrate an empty DB at a mistyped path, and reporting
  // "owner created" against a fresh file nobody serves is the worst failure mode.
  it('refuses a missing DB file instead of creating one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'create-owner-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const missing = join(dir, 'nope.db')

    await expect(
      createOwner({
        dbFile: missing,
        email: 'owner@test.com',
        password: PASSWORD
      })
    ).rejects.toThrow(/no auth database at/)
    expect(existsSync(missing)).toBe(false)
  })

  it('emits an audit event through the same seam reset-password uses', async () => {
    const { dbFile } = makeDb()
    const events: AuthEvent[] = []
    const result = await createOwner({
      dbFile,
      email: 'owner@test.com',
      password: PASSWORD,
      onAuthEvent: (e) => events.push(e)
    })
    expect(events).toEqual([{ type: 'owner.created', targetId: result.userId }])
  })
})

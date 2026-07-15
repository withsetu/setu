// #386 review: openInternalAuthContext is the ONE shared bootstrap for host-side maintenance
// tools (apps/api's reset-password script, e2e/lib/seed-users.ts) that need better-auth's
// internal context over an existing drizzle handle without a running server. This pins the
// minimal surface those callers rely on: internalAdapter user/account rows + scrypt hashing.
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { openInternalAuthContext } from '../src'

function makeDb() {
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })
  return db
}

describe('openInternalAuthContext', () => {
  it('resolves a context whose internalAdapter + password.hash cover the seeding/recovery surface', async () => {
    const ctx = await openInternalAuthContext(makeDb())

    const user = await ctx.internalAdapter.createUser({
      email: 'host@setu.test',
      name: 'Host Actor',
      role: 'admin',
      emailVerified: true
    })
    const hashed = await ctx.password.hash('a-long-enough-password')
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: hashed
    })

    const found = await ctx.internalAdapter.findUserByEmail('host@setu.test')
    expect(found?.user.id).toBe(user.id)
    const accounts = await ctx.internalAdapter.findAccounts(user.id)
    expect(accounts.some((a) => a.providerId === 'credential')).toBe(true)
    // scrypt is secret-independent — what the helper hashes, any real instance verifies.
    expect(
      await ctx.password.verify({
        hash: hashed,
        password: 'a-long-enough-password'
      })
    ).toBe(true)
    // The min-length config the reset script enforces is reachable from this context too.
    expect(ctx.password.config.minPasswordLength).toBeGreaterThan(0)
  })
})

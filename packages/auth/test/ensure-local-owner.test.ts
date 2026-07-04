import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { user as userTable, account as accountTable } from '@setu/db-sqlite/schema'
import { createAuth } from '../src'
import { ensureLocalOwner } from '../src/ensure-local-owner'

function makeAuth() {
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })
  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173'],
  })
  return { db, auth }
}

describe('ensureLocalOwner', () => {
  it('creates an admin-role user with no credential account on first call', async () => {
    const { db, auth } = makeAuth()

    const userId = await ensureLocalOwner(auth, { email: 'owner@local.test', name: 'Owner Person' })

    const rows = await db.select().from(userTable).where(eq(userTable.id, userId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.email).toBe('owner@local.test')
    expect(rows[0]?.name).toBe('Owner Person')
    expect(rows[0]?.role).toBe('admin')

    const accounts = await db.select().from(accountTable).where(eq(accountTable.userId, userId))
    expect(accounts).toHaveLength(0) // no credential/password account was created
  })

  it('is idempotent: a second call with the same identity returns the same user id, no duplicate row', async () => {
    const { db, auth } = makeAuth()

    const first = await ensureLocalOwner(auth, { email: 'owner@local.test', name: 'Owner Person' })
    const second = await ensureLocalOwner(auth, { email: 'owner@local.test', name: 'Owner Person' })

    expect(second).toBe(first)
    const rows = await db.select().from(userTable).where(eq(userTable.email, 'owner@local.test'))
    expect(rows).toHaveLength(1)
  })

  it('credential sign-in against the passwordless owner fails (any password), distinguishable only by the fact it never succeeds', async () => {
    const { auth } = makeAuth()
    await ensureLocalOwner(auth, { email: 'owner@local.test', name: 'Owner Person' })

    await expect(
      auth.api.signInEmail({ body: { email: 'owner@local.test', password: 'whatever12345' } }),
    ).rejects.toMatchObject({
      status: 'UNAUTHORIZED',
      body: expect.objectContaining({ code: 'INVALID_EMAIL_OR_PASSWORD' }),
    })
  })
})

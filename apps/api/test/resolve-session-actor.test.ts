import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { user as userTable } from '@setu/db-sqlite/schema'
import { createAuth } from '@setu/auth'
import { resolveSessionActor } from '../src/auth/resolve-session-actor'

function makeAuth() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })
  return { db, auth: createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173'],
  }) }
}

describe('resolveSessionActor', () => {
  it('maps a session to an Actor', async () => {
    const { auth } = makeAuth()
    await auth.api.signUpEmail({ body: { email: 'a@b.co', password: 'hunter2hunter2', name: 'A' } })
    const res = await auth.api.signInEmail({ body: { email: 'a@b.co', password: 'hunter2hunter2' }, asResponse: true })
    const cookie = res.headers.get('set-cookie')!.split(';')[0]
    const actor = await resolveSessionActor(auth)(new Request('http://x/', { headers: { cookie } }))
    expect(actor).toEqual({ id: expect.any(String), role: 'viewer' })
  })

  it('returns null for no cookie', async () => {
    const { auth } = makeAuth()
    const actor = await resolveSessionActor(auth)(new Request('http://x/', { headers: {} }))
    expect(actor).toBeNull()
  })

  it('returns null for garbage cookie', async () => {
    const { auth } = makeAuth()
    const actor = await resolveSessionActor(auth)(new Request('http://x/', { headers: { cookie: 'garbage=value' } }))
    expect(actor).toBeNull()
  })

  it('returns null for banned user', async () => {
    const { db, auth } = makeAuth()
    const user = await auth.api.signUpEmail({ body: { email: 'a@b.co', password: 'hunter2hunter2', name: 'A' } })
    // Sign in before banning to get a session cookie
    const res = await auth.api.signInEmail({ body: { email: 'a@b.co', password: 'hunter2hunter2' }, asResponse: true })
    const cookie = res.headers.get('set-cookie')!.split(';')[0]
    // Ban the user by updating the database
    await db.update(userTable).set({ banned: true }).where(eq(userTable.id, user.user.id))
    // Now try to use the previously valid session with a banned user
    const actor = await resolveSessionActor(auth)(new Request('http://x/', { headers: { cookie } }))
    expect(actor).toBeNull()
  })
})

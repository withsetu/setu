import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createAuth } from '../src'

function makeAuth() {
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })
  return createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173'],
  })
}

describe('createAuth', () => {
  it('signs up and signs in with email/password; default role viewer', async () => {
    const auth = makeAuth()
    const res = await auth.api.signUpEmail({ body: { email: 'a@b.co', password: 'hunter2hunter2', name: 'A' } })
    expect(res.user.email).toBe('a@b.co')
    const signin = await auth.api.signInEmail({
      body: { email: 'a@b.co', password: 'hunter2hunter2' },
      asResponse: true,
    })
    expect(signin.headers.get('set-cookie')).toMatch(/better-auth/)
  })

  it('rejects a wrong password', async () => {
    const auth = makeAuth()
    await auth.api.signUpEmail({ body: { email: 'a@b.co', password: 'hunter2hunter2', name: 'A' } })
    await expect(
      auth.api.signInEmail({ body: { email: 'a@b.co', password: 'nope-nope-nope' } }),
    ).rejects.toThrow()
  })
})

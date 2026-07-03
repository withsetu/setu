import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSqliteDb, countUsers, user } from '../src/index'

describe('countUsers', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  it('is 0 on a freshly migrated db', () => {
    dir = mkdtempSync(join(tmpdir(), 'setu-count-users-'))
    const db = openSqliteDb(join(dir, 'auth.db'))
    expect(countUsers(db)).toBe(0)
  })

  it('counts rows inserted into the user table', () => {
    dir = mkdtempSync(join(tmpdir(), 'setu-count-users-'))
    const db = openSqliteDb(join(dir, 'auth.db'))
    const now = new Date()
    db.insert(user).values({ id: 'a', name: 'A', email: 'a@example.com', createdAt: now, updatedAt: now }).run()
    db.insert(user).values({ id: 'b', name: 'B', email: 'b@example.com', createdAt: now, updatedAt: now }).run()
    expect(countUsers(db)).toBe(2)
  })
})

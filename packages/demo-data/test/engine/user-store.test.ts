/** Proves the default UserStore against a REAL temp sqlite db: better-auth's
 *  own internalAdapter creates/finds/hard-deletes exactly like the running
 *  api's admin-invite path would (no network, throwaway db file). */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createSqliteUserStore,
  submissionsDbFile
} from '../../src/engine/user-store'

describe('createSqliteUserStore (real sqlite)', () => {
  it('creates, finds, and hard-deletes a credential user', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'demo-seed-auth-'))
    const store = createSqliteUserStore(path.join(dir, 'auth.db'))

    expect(await store.findByEmail('demo-author-1@demo.setu.test')).toBeNull()
    const created = await store.create({
      email: 'demo-author-1@demo.setu.test',
      name: 'Demo Author 1',
      role: 'author',
      password: 'a-generated-demo-password'
    })
    expect(created.id).toBeTruthy()
    const found = await store.findByEmail('demo-author-1@demo.setu.test')
    expect(found?.id).toBe(created.id)

    await store.deleteById(created.id)
    expect(await store.findByEmail('demo-author-1@demo.setu.test')).toBeNull()
  })

  it('derives the sandbox db path the api actually opens', () => {
    expect(submissionsDbFile('/tmp/sandbox')).toBe(
      path.join('/tmp/sandbox', '.setu', 'submissions.db')
    )
  })
})

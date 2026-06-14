import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteAdapter } from '../src/index'

describe('sqlite adapter (on-disk)', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  it('persists drafts across adapter instances on a real file (migrate idempotent on reopen)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'saytu-db-'))
    const file = join(dir, 'saytu.db')

    const a = createSqliteAdapter(file)
    await a.saveDraft({
      collection: 'post',
      locale: 'en',
      slug: 'persisted',
      content: { type: 'doc', content: [] },
      metadata: { title: 'Kept' },
    })
    await a.close()

    // Reopen a FRESH adapter on the same file: migrate() must be idempotent and the row must remain.
    const b = createSqliteAdapter(file)
    const got = await b.getDraft({ collection: 'post', locale: 'en', slug: 'persisted' })
    expect(got?.metadata).toEqual({ title: 'Kept' })
    await b.close()
  })
})

import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { runDataPortContract } from '@setu/db-testing'
import { createIdbDataPort } from '../src/index'

let n = 0
const freshName = () => `db-idb-test-${(n += 1)}`

runDataPortContract(() => createIdbDataPort(freshName()))

describe('createIdbDataPort persistence', () => {
  it('restores a draft after closing and reopening the same database', async () => {
    const name = freshName()
    const a = await createIdbDataPort(name)
    await a.saveDraft({
      collection: 'post',
      locale: 'en',
      slug: 'persisted',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'kept' }] }] },
      metadata: { title: 'Persisted' },
    })
    await a.close()

    const b = await createIdbDataPort(name)
    const got = await b.getDraft({ collection: 'post', locale: 'en', slug: 'persisted' })
    expect(got?.metadata.title).toBe('Persisted')
    await b.close()
  })
})

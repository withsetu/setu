import { describe, it, expect } from 'vitest'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { DraftInput, TiptapDoc } from '../../src/index'
import { createIndexService } from '../../src/index'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const seed: DraftInput[] = [
  { collection: 'post', locale: 'en', slug: 'a', content: doc('a'), metadata: { title: 'Alpha' } },
]

function svc() {
  const data = createMemoryDataPort(seed)
  const git = createMemoryGitPort()
  const index = createMemoryIndexPort()
  return { data, index, service: createIndexService({ data, git, index, deployedAt: () => null }) }
}

describe('IndexService reindexEntry', () => {
  it('upserts a row for a newly saved draft', async () => {
    const { data, service } = svc()
    await service.rebuild()
    await data.saveDraft({ collection: 'post', locale: 'en', slug: 'b', content: doc('b'), metadata: { title: 'Bravo' } })
    await service.reindexEntry({ collection: 'post', locale: 'en', slug: 'b' })
    const r = await service.query({ collection: 'post', offset: 0, limit: 10 })
    expect(r.rows.map((x) => x.title).sort()).toEqual(['Alpha', 'Bravo'])
  })

  it('removes the row when the entry has neither draft nor commit', async () => {
    const { data, service } = svc()
    await service.rebuild()
    await data.deleteDraft({ collection: 'post', locale: 'en', slug: 'a' })
    await service.reindexEntry({ collection: 'post', locale: 'en', slug: 'a' })
    expect((await service.query({ collection: 'post', offset: 0, limit: 10 })).total).toBe(0)
  })
})

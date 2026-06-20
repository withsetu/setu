import { describe, it, expect } from 'vitest'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryIndexPort } from '@setu/db-memory'
import type { DraftInput, TiptapDoc } from '../../src/index'
import { createIndexService, INDEX_VERSION } from '../../src/index'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const seed: DraftInput[] = [
  { collection: 'post', locale: 'en', slug: 'a', content: doc('a'), metadata: { title: 'Alpha' } },
  { collection: 'post', locale: 'en', slug: 'b', content: doc('b'), metadata: { title: 'Bravo' } },
  { collection: 'page', locale: 'en', slug: 'about', content: doc('c'), metadata: { title: 'About' } },
]
const noDeploy = () => null

function svc() {
  const data = createMemoryDataPort(seed)
  const git = createMemoryGitPort()
  const index = createMemoryIndexPort()
  return { data, git, index, service: createIndexService({ data, git, index, deployedAt: noDeploy }) }
}

describe('IndexService rebuild/ensureBuilt/query', () => {
  it('rebuild populates the index from drafts + git and stamps meta', async () => {
    const { index, service } = svc()
    await service.rebuild()
    const r = await service.query({ collection: 'post', offset: 0, limit: 10 })
    expect(r.total).toBe(2)
    expect(r.rows.map((x) => x.title).sort()).toEqual(['Alpha', 'Bravo'])
    expect((await index.getMeta()).version).toBe(INDEX_VERSION)
  })

  it('ensureBuilt builds when empty and is a no-op when already current', async () => {
    const { index, service } = svc()
    await service.ensureBuilt()
    expect((await index.getMeta()).indexedSha).not.toBeUndefined()
    await index.clear() // simulate: rows gone but meta still current
    await service.ensureBuilt() // version matches → no rebuild
    expect((await service.query({ collection: 'post', offset: 0, limit: 10 })).total).toBe(0)
  })

  it('query maps index rows back to ContentRow shape', async () => {
    const { service } = svc()
    await service.rebuild()
    const r = await service.query({ collection: 'page', offset: 0, limit: 10 })
    expect(r.rows[0]).toMatchObject({ ref: { collection: 'page', locale: 'en', slug: 'about' }, title: 'About' })
  })
})

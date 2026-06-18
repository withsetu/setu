import { describe, it, expect } from 'vitest'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { bootstrapServices, seedDrafts } from '../src/data/store'

describe('bootstrapServices seed-on-empty', () => {
  it('seeds the sample drafts when the store is empty', async () => {
    const services = await bootstrapServices(createMemoryDataPort(), createMemoryGitPort())
    const drafts = await services.data.listDrafts()
    expect(drafts).toHaveLength(seedDrafts.length)
    expect(drafts.map((d) => d.slug).sort()).toEqual(seedDrafts.map((d) => d.slug).sort())
  })

  it('does NOT re-seed when the store already has content', async () => {
    const data = createMemoryDataPort([
      { collection: 'post', locale: 'en', slug: 'mine', content: { type: 'doc', content: [] }, metadata: { title: 'Mine' } },
    ])
    const services = await bootstrapServices(data, createMemoryGitPort())
    const drafts = await services.data.listDrafts()
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.slug).toBe('mine')
  })

  it('does NOT re-seed when Git has commits but DB is empty', async () => {
    const git = createMemoryGitPort([{ path: 'content/post/en/x.mdoc', content: '# x' }])
    const services = await bootstrapServices(createMemoryDataPort(), git)
    expect(await services.data.listDrafts()).toHaveLength(0)
  })
})

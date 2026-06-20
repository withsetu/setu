import { describe, expect, it } from 'vitest'
import { listContentEntries } from './list-entries'
import type { Draft } from '../data/types'

const doc = { type: 'doc', content: [] } as unknown as Draft['content']
const draft = (over: Partial<Draft>): Draft => ({
  collection: 'post', locale: 'en', slug: 'p', content: doc,
  metadata: {}, baseSha: null, baseContent: null, createdAt: 0, updatedAt: 1,
  ...over,
})
const noDeploy = () => null

describe('listContentEntries — tags', () => {
  it('reads + normalizes + dedupes tags from a draft', () => {
    const rows = listContentEntries({
      drafts: [draft({ metadata: { title: 'P', tags: ['React', 'react', '!!', 'Next JS'] } })],
      committed: [],
      deployedAt: noDeploy,
    })
    expect(rows[0]!.tags).toEqual(['react', 'next-js'])
  })

  it('reads tags from committed frontmatter when there is no draft', () => {
    const committed = [{ ref: { collection: 'post', locale: 'en', slug: 'c' }, content: '---\ntitle: C\ntags:\n  - vue\n  - Vue\n---\nbody' }]
    const rows = listContentEntries({ drafts: [], committed, deployedAt: noDeploy })
    expect(rows[0]!.tags).toEqual(['vue'])
  })

  it('defaults to [] when tags are absent or non-array', () => {
    const rows = listContentEntries({
      drafts: [draft({ metadata: { title: 'P', tags: 'notarray' } })],
      committed: [],
      deployedAt: noDeploy,
    })
    expect(rows[0]!.tags).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { listContentEntries } from './list-entries'
import type { Draft } from '../data/types'

const doc = { type: 'doc', content: [] } as unknown as Draft['content']
const draft = (over: Partial<Draft>): Draft => ({
  collection: 'post',
  locale: 'en',
  slug: 'p',
  content: doc,
  metadata: {},
  baseSha: null,
  baseContent: null,
  updatedAt: 1,
  createdAt: 0,
  ...over
})
const noDeploy = () => null

describe('listContentEntries — categories', () => {
  it('reads + dedupes category slugs from a draft', () => {
    const rows = listContentEntries({
      drafts: [
        draft({
          metadata: { title: 'P', categories: ['react', 'react', 'tutorials'] }
        })
      ],
      committed: [],
      deployedAt: noDeploy
    })
    expect(rows[0]!.categories).toEqual(['react', 'tutorials'])
  })

  it('reads categories from committed frontmatter when there is no draft', () => {
    const committed = [
      {
        ref: { collection: 'post', locale: 'en', slug: 'c' },
        content: '---\ntitle: C\ncategories:\n  - guides\n---\nbody'
      }
    ]
    const rows = listContentEntries({
      drafts: [],
      committed,
      deployedAt: noDeploy
    })
    expect(rows[0]!.categories).toEqual(['guides'])
  })

  it('defaults to [] when categories are absent or non-array', () => {
    const rows = listContentEntries({
      drafts: [draft({ metadata: { title: 'P', categories: 'nope' } })],
      committed: [],
      deployedAt: noDeploy
    })
    expect(rows[0]!.categories).toEqual([])
  })
})

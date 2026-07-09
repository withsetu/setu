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
  createdAt: 0,
  updatedAt: 1,
  ...over
})
const noDeploy = { deployedSha: null, changed: [] }

describe('listContentEntries — featuredImage', () => {
  it('reads featuredImage from a draft', () => {
    const rows = listContentEntries({
      drafts: [
        draft({
          metadata: { title: 'P', featuredImage: '/media/2026/06/a.webp' }
        })
      ],
      committed: [],
      deploy: noDeploy
    })
    expect(rows[0]!.featuredImage).toBe('/media/2026/06/a.webp')
  })

  it('reads featuredImage from committed frontmatter when there is no draft', () => {
    const committed = [
      {
        ref: { collection: 'post', locale: 'en', slug: 'c' },
        content:
          '---\ntitle: C\nfeaturedImage: /media/2026/06/b.webp\n---\nbody'
      }
    ]
    const rows = listContentEntries({
      drafts: [],
      committed,
      deploy: noDeploy
    })
    expect(rows[0]!.featuredImage).toBe('/media/2026/06/b.webp')
  })

  it('omits featuredImage when absent or blank', () => {
    const rows = listContentEntries({
      drafts: [
        draft({ metadata: { title: 'P' } }),
        draft({ slug: 'q', metadata: { title: 'Q', featuredImage: '' } })
      ],
      committed: [],
      deploy: noDeploy
    })
    expect(rows[0]!.featuredImage).toBeUndefined()
    expect(rows[1]!.featuredImage).toBeUndefined()
  })
})

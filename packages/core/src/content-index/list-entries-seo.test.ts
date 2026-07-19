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

describe('listContentEntries — hasSeoOverrides (#577)', () => {
  it('true when a draft has any non-empty seo override field', () => {
    const rows = listContentEntries({
      drafts: [
        draft({ metadata: { title: 'P', seo: { title: 'SEO title' } } }),
        draft({ slug: 'q', metadata: { title: 'Q', seo: { noindex: true } } })
      ],
      committed: [],
      deploy: noDeploy
    })
    expect(rows[0]!.hasSeoOverrides).toBe(true)
    expect(rows[1]!.hasSeoOverrides).toBe(true)
  })

  it('reads the seo block from committed frontmatter when there is no draft', () => {
    const rows = listContentEntries({
      drafts: [],
      committed: [
        {
          ref: { collection: 'post', locale: 'en', slug: 'c' },
          content:
            '---\ntitle: C\nseo:\n  description: Custom description\n---\nbody'
        }
      ],
      deploy: noDeploy
    })
    expect(rows[0]!.hasSeoOverrides).toBe(true)
  })

  it('false when the seo block is absent, empty, or holds only blank/false fields', () => {
    const rows = listContentEntries({
      drafts: [
        draft({ metadata: { title: 'P' } }),
        draft({ slug: 'q', metadata: { title: 'Q', seo: {} } }),
        draft({
          slug: 'r',
          metadata: { title: 'R', seo: { title: '  ', noindex: false } }
        }),
        draft({ slug: 's', metadata: { title: 'S', seo: 'not-an-object' } })
      ],
      committed: [],
      deploy: noDeploy
    })
    for (const r of rows) expect(r.hasSeoOverrides).toBe(false)
  })

  it("the draft's seo block wins over the committed one", () => {
    const ref = { collection: 'post', locale: 'en', slug: 'p' }
    const committed = [
      { ref, content: '---\ntitle: P\nseo:\n  title: Committed SEO\n---\nbody' }
    ]
    // Draft cleared the override → indicator flips off even though committed has one.
    const rows = listContentEntries({
      drafts: [draft({ metadata: { title: 'P' } })],
      committed,
      deploy: noDeploy
    })
    expect(rows[0]!.hasSeoOverrides).toBe(false)
  })
})

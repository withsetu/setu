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

describe('listContentEntries — date', () => {
  it('projects committed frontmatter `date` (unquoted YAML date) as epoch ms', () => {
    const committed = [
      {
        ref: { collection: 'post', locale: 'en', slug: 'c' },
        content: '---\ntitle: C\ndate: 2026-06-20\n---\nbody'
      }
    ]
    const rows = listContentEntries({
      drafts: [],
      committed,
      deploy: noDeploy
    })
    expect(rows[0]!.date).toBe(Date.UTC(2026, 5, 20))
  })

  it('falls back to `pubDate` when `date` is absent', () => {
    const committed = [
      {
        ref: { collection: 'post', locale: 'en', slug: 'c' },
        content: '---\ntitle: C\npubDate: 2026-01-05\n---\nbody'
      }
    ]
    const rows = listContentEntries({
      drafts: [],
      committed,
      deploy: noDeploy
    })
    expect(rows[0]!.date).toBe(Date.UTC(2026, 0, 5))
  })

  it('reads date from a draft, taking priority over a same-named committed file', () => {
    const rows = listContentEntries({
      drafts: [
        draft({ slug: 'c', metadata: { title: 'P', date: '2026-03-10' } })
      ],
      committed: [
        {
          ref: { collection: 'post', locale: 'en', slug: 'c' },
          content: '---\ntitle: C\ndate: 2026-01-01\n---\nbody'
        }
      ],
      deploy: noDeploy
    })
    expect(rows[0]!.date).toBe(Date.UTC(2026, 2, 10))
  })

  it('is null when there is no date and no pubDate', () => {
    const rows = listContentEntries({
      drafts: [draft({ metadata: { title: 'P' } })],
      committed: [],
      deploy: noDeploy
    })
    expect(rows[0]!.date).toBeNull()
  })

  it('is null when the draft has an empty metadata date and there is no committed fallback', () => {
    const rows = listContentEntries({
      drafts: [draft({ metadata: { title: 'P', date: '' } })],
      committed: [],
      deploy: noDeploy
    })
    expect(rows[0]!.date).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import type { Draft, EntryRef, TiptapDoc } from '../../src/index'
import {
  listContentEntries,
  serializeMdoc,
  tiptapToMarkdoc
} from '../../src/index'

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})

function draft(
  ref: EntryRef,
  title: string,
  body: string,
  updatedAt = 1000
): Draft {
  return {
    ...ref,
    content: doc(body),
    metadata: { title },
    baseSha: null,
    createdAt: updatedAt,
    updatedAt
  }
}

/** Serialize a committed .mdoc the way publish does, so committed === draft when
 *  the bodies match. */
function committedFor(d: Draft): string {
  return serializeMdoc({
    frontmatter: d.metadata,
    body: tiptapToMarkdoc(d.content)
  })
}

const noDeploy = () => null

describe('listContentEntries', () => {
  it('draft-only entry → one row, Draft (git empty), updatedAt set, hasDraft true', () => {
    const d = draft(
      { collection: 'post', locale: 'en', slug: 'a' },
      'A',
      'body a',
      1234
    )
    const rows = listContentEntries({
      drafts: [d],
      committed: [],
      deployedAt: noDeploy
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      ref: { collection: 'post', locale: 'en', slug: 'a' },
      title: 'A',
      locale: 'en',
      lifecycle: { state: 'draft' },
      updatedAt: 1234,
      hasDraft: true
    })
  })

  it('committed-only entry → one row, Staged, title from frontmatter, updatedAt null, hasDraft false', () => {
    const ref = { collection: 'post', locale: 'en', slug: 'ghost' }
    const committed = serializeMdoc({
      frontmatter: { title: 'Ghost' },
      body: 'gone'
    })
    const rows = listContentEntries({
      drafts: [],
      committed: [{ ref, content: committed }],
      deployedAt: noDeploy
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      ref,
      title: 'Ghost',
      lifecycle: { state: 'staged' },
      updatedAt: null,
      hasDraft: false
    })
  })

  it('draft AND committed for the same ref → a single row, hasDraft true', () => {
    const d = draft(
      { collection: 'post', locale: 'en', slug: 'a' },
      'A',
      'body a'
    )
    const rows = listContentEntries({
      drafts: [d],
      committed: [
        {
          ref: { collection: 'post', locale: 'en', slug: 'a' },
          content: committedFor(d)
        }
      ],
      deployedAt: noDeploy
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      hasDraft: true,
      lifecycle: { state: 'staged' }
    })
  })

  it('committed-and-deployed entry → Live', () => {
    const ref = { collection: 'post', locale: 'en', slug: 'ghost' }
    const committed = serializeMdoc({
      frontmatter: { title: 'Ghost' },
      body: 'gone'
    })
    const rows = listContentEntries({
      drafts: [],
      committed: [{ ref, content: committed }],
      deployedAt: (p) => (p === 'content/post/en/ghost.mdoc' ? committed : null)
    })
    expect(rows[0]?.lifecycle).toEqual({ state: 'live' })
  })

  it('falls back to the slug when no title is present', () => {
    const ref = { collection: 'post', locale: 'en', slug: 'untitled' }
    const committed = serializeMdoc({ frontmatter: {}, body: 'x' })
    const rows = listContentEntries({
      drafts: [],
      committed: [{ ref, content: committed }],
      deployedAt: noDeploy
    })
    expect(rows[0]?.title).toBe('untitled')
  })

  it('returns one row per distinct ref (no duplicates across drafts+committed)', () => {
    const d1 = draft({ collection: 'post', locale: 'en', slug: 'a' }, 'A', 'a')
    const ref2 = { collection: 'post', locale: 'en', slug: 'b' }
    const rows = listContentEntries({
      drafts: [d1],
      committed: [
        {
          ref: { collection: 'post', locale: 'en', slug: 'a' },
          content: committedFor(d1)
        },
        {
          ref: ref2,
          content: serializeMdoc({ frontmatter: { title: 'B' }, body: 'b' })
        }
      ],
      deployedAt: noDeploy
    })
    expect(rows.map((r) => r.ref.slug).sort()).toEqual(['a', 'b'])
  })

  it('orders drafts first (in input order), then committed-only entries', () => {
    const dB = draft({ collection: 'post', locale: 'en', slug: 'b' }, 'B', 'b')
    const dA = draft({ collection: 'post', locale: 'en', slug: 'a' }, 'A', 'a')
    const rows = listContentEntries({
      drafts: [dB, dA], // input order B, A
      committed: [
        {
          ref: { collection: 'post', locale: 'en', slug: 'a' },
          content: committedFor(dA)
        }, // dup of a draft
        {
          ref: { collection: 'post', locale: 'en', slug: 'c' },
          content: serializeMdoc({ frontmatter: { title: 'C' }, body: 'c' })
        } // committed-only
      ],
      deployedAt: noDeploy
    })
    // drafts first in their input order (b, a), then committed-only (c); no dup of a
    expect(rows.map((r) => r.ref.slug)).toEqual(['b', 'a', 'c'])
  })

  it('falls back past a non-string draft title to the committed frontmatter title', () => {
    const ref = { collection: 'post', locale: 'en', slug: 'weird' }
    const d: Draft = {
      ...ref,
      content: doc('x'),
      metadata: { title: 42 },
      baseSha: null,
      createdAt: 1,
      updatedAt: 1
    }
    const committed = serializeMdoc({
      frontmatter: { title: 'Real Title' },
      body: 'x'
    })
    const rows = listContentEntries({
      drafts: [d],
      committed: [{ ref, content: committed }],
      deployedAt: noDeploy
    })
    expect(rows[0]?.title).toBe('Real Title')
  })
})

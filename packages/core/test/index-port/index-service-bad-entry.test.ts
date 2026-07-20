import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { DraftInput, TiptapDoc } from '../../src/index'
import { createIndexService } from '../../src/index'

/** One bad stored draft must cost ONE row, never the whole list (#713/#714b).
 *
 *  These drive the REAL index service over memory ports, not `listContentEntries`
 *  directly, because the defect being fixed is a blast-radius one: the throw
 *  escaped `order.map(...)` and took `rebuild()`/`ensureBuilt()` with it, so the
 *  admin content list rendered NOTHING instead of the other N-1 entries. The
 *  property under test is therefore "the healthy entries still come back", not
 *  merely "it does not throw". */

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})

const healthy: DraftInput[] = [
  {
    collection: 'post',
    locale: 'en',
    slug: 'alpha',
    content: doc('a'),
    metadata: { title: 'Alpha' }
  },
  {
    collection: 'post',
    locale: 'en',
    slug: 'bravo',
    content: doc('b'),
    metadata: { title: 'Bravo' }
  }
]

function svc(bad: DraftInput) {
  const data = createMemoryDataPort([...healthy, bad])
  const git = createMemoryGitPort()
  const index = createMemoryIndexPort()
  return {
    data,
    git,
    index,
    service: createIndexService({
      data,
      git,
      index,
      deploy: () => ({ deployedSha: null, changed: [] })
    })
  }
}

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort()

afterEach(() => {
  vi.restoreAllMocks()
})

/** #713 — `tiptapToMarkdoc` throws on a node/mark it does not serialize (from #665).
 *  Stored draft JSON never passes through a ProseMirror schema, and drafts outlive
 *  schema changes: re-enabling underline or a Tiptap upgrade activates this. */
describe('#713 — an unserializable stored draft body costs one row', () => {
  const cases: { name: string; content: TiptapDoc }[] = [
    {
      name: 'unknown mark (underline)',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'x', marks: [{ type: 'underline' }] }
            ]
          }
        ]
      }
    },
    {
      name: 'unknown mark (textStyle)',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'x', marks: [{ type: 'textStyle' }] }
            ]
          }
        ]
      }
    },
    {
      name: 'unknown node type',
      content: { type: 'doc', content: [{ type: 'mysteryBlock' }] }
    }
  ]

  for (const c of cases) {
    it(`rebuild() still returns the healthy entries — ${c.name}`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { service } = svc({
        collection: 'post',
        locale: 'en',
        slug: 'broken',
        content: c.content,
        metadata: { title: 'Broken' }
      })

      await expect(service.rebuild()).resolves.toBeUndefined()
      const r = await service.query({
        collection: 'post',
        offset: 0,
        limit: 10
      })
      // The whole point: the good rows survive the bad one.
      expect(titles(r.rows)).toEqual(['Alpha', 'Bravo', 'Broken'])
      expect(r.total).toBe(3)
    })
  }

  it('the broken entry is rendered as a row carrying indexError, not omitted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { service } = svc({
      collection: 'post',
      locale: 'en',
      slug: 'broken',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'x', marks: [{ type: 'underline' }] }
            ]
          }
        ]
      },
      metadata: { title: 'Broken' }
    })
    await service.rebuild()
    const r = await service.query({ collection: 'post', offset: 0, limit: 10 })
    const broken = r.rows.find((x) => x.ref.slug === 'broken')
    // A MISSING row is indistinguishable from a deleted entry, so the row must
    // exist and say what is wrong with it.
    expect(broken).toBeDefined()
    expect(broken!.indexError).toContain('underline')
    // …and the healthy rows must NOT be flagged.
    for (const ok of r.rows.filter((x) => x.ref.slug !== 'broken'))
      expect(ok.indexError).toBeUndefined()
  })

  it('logs the offending entry so the drift stays visible', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { service } = svc({
      collection: 'post',
      locale: 'en',
      slug: 'broken',
      content: { type: 'doc', content: [{ type: 'mysteryBlock' }] },
      metadata: { title: 'Broken' }
    })
    await service.rebuild()
    expect(warn).toHaveBeenCalled()
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('post/en/broken')
    expect(logged).toContain('mysteryBlock')
  })
})

/** #714(b) — `contentPath` throws on a non-canonical segment (from #670), and
 *  `list-entries` called it unconditionally per row. `DataPort.saveDraft` does no
 *  slug validation, so a draft persisted before #670 is enough to trigger it.
 *  Committed content cannot reach this (all committed `.mdoc` were swept clean) —
 *  the exposure is legacy DB drafts. */
describe('#714b — a non-canonical stored slug costs one row', () => {
  for (const slug of ['legacy slug ', 'x/y', '..', 'ctrl\u0001x'])
    it(`rebuild() and ensureBuilt() still return the healthy entries — ${JSON.stringify(slug)}`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { service } = svc({
        collection: 'post',
        locale: 'en',
        slug,
        content: doc('legacy'),
        metadata: { title: 'Legacy' }
      })

      await expect(service.rebuild()).resolves.toBeUndefined()
      const afterRebuild = await service.query({
        collection: 'post',
        offset: 0,
        limit: 10
      })
      expect(titles(afterRebuild.rows)).toEqual(['Alpha', 'Bravo', 'Legacy'])

      await expect(service.ensureBuilt()).resolves.toBeUndefined()
      const afterEnsure = await service.query({
        collection: 'post',
        offset: 0,
        limit: 10
      })
      expect(titles(afterEnsure.rows)).toEqual(['Alpha', 'Bravo', 'Legacy'])
      expect(
        afterEnsure.rows.find((x) => x.ref.slug === slug)?.indexError
      ).toContain('canonical path segment')
    })
})

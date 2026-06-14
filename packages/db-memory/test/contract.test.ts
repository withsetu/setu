import { describe, it, expect } from 'vitest'
import { runDataPortContract } from '@saytu/db-testing'
import type { DraftInput, TiptapDoc } from '@saytu/core'
import { createMemoryDataPort } from '../src/index'

runDataPortContract(() => createMemoryDataPort())

const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('createMemoryDataPort seed', () => {
  it('applies seed drafts so listDrafts returns them', async () => {
    const seed: DraftInput[] = [
      { collection: 'post', locale: 'en', slug: 'a', content: doc('a'), metadata: { title: 'A' } },
      { collection: 'page', locale: 'en', slug: 'b', content: doc('b'), metadata: { title: 'B' } },
    ]
    const db = createMemoryDataPort(seed)
    expect((await db.listDrafts()).map((d) => d.slug).sort()).toEqual(['a', 'b'])
    expect((await db.listDrafts({ collection: 'post' })).map((d) => d.slug)).toEqual(['a'])
    expect((await db.getDraft({ collection: 'page', locale: 'en', slug: 'b' }))?.metadata).toEqual({ title: 'B' })
  })

  it('does not collide when fields contain the separator char (space)', async () => {
    const db = createMemoryDataPort()
    await db.saveDraft({ collection: 'a b', locale: 'en', slug: 'x', content: doc('1'), metadata: { n: 1 } })
    await db.saveDraft({ collection: 'a', locale: 'b en', slug: 'x', content: doc('2'), metadata: { n: 2 } })
    expect((await db.getDraft({ collection: 'a b', locale: 'en', slug: 'x' }))?.metadata).toEqual({ n: 1 })
    expect((await db.getDraft({ collection: 'a', locale: 'b en', slug: 'x' }))?.metadata).toEqual({ n: 2 })
  })

  it('returns value-isolated drafts (mutating a returned draft does not corrupt the store)', async () => {
    const db = createMemoryDataPort()
    const ref = { collection: 'post', locale: 'en', slug: 'iso' }
    const saved = await db.saveDraft({ ...ref, content: doc('orig'), metadata: { title: 'Orig' } })
    ;(saved.metadata as { title: string }).title = 'MUTATED'
    expect((await db.getDraft(ref))?.metadata).toEqual({ title: 'Orig' })
  })
})

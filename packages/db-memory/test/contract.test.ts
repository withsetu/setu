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
})

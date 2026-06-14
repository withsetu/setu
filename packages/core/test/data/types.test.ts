import { describe, it, expect } from 'vitest'
import type { DataPort, Draft, DraftInput, EntryRef, Lock } from '../../src/index'

describe('DataPort domain types', () => {
  it('Draft / DraftInput / Lock shapes compile and carry the expected fields', () => {
    const ref: EntryRef = { collection: 'post', locale: 'en', slug: 'x' }
    const draft: Draft = {
      ...ref,
      content: { type: 'doc', content: [] },
      metadata: { title: 'T' },
      baseSha: null,
      createdAt: 1,
      updatedAt: 2,
    }
    const input: DraftInput = { ...ref, content: { type: 'doc', content: [] }, metadata: {} }
    const lock: Lock = { ...ref, lockedBy: 'a@x.com', lockedAt: 1 }
    expect([draft.slug, input.collection, lock.lockedBy]).toEqual(['x', 'post', 'a@x.com'])
  })

  it('DataPort is structurally implementable', () => {
    const partial: Pick<DataPort, 'close'> = { close: async () => {} }
    expect(typeof partial.close).toBe('function')
  })
})

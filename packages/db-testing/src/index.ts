import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DataPort, TiptapDoc } from '@setu/core'

const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** Run the DataPort behavioral contract against an adapter. `makeAdapter` must
 *  return a FRESH, empty adapter (e.g. a new in-memory DB) on each call. */
export function runDataPortContract(makeAdapter: () => Promise<DataPort> | DataPort): void {
  describe('DataPort contract', () => {
    let db: DataPort
    beforeEach(async () => {
      db = await makeAdapter()
    })
    afterEach(async () => {
      await db.close()
    })

    // --- drafts ---
    it('returns null for an absent draft', async () => {
      expect(await db.getDraft({ collection: 'post', locale: 'en', slug: 'x' })).toBeNull()
    })

    it('saves and reads back a draft, round-tripping content/metadata/baseSha', async () => {
      const input = {
        collection: 'post',
        locale: 'en',
        slug: 'hello',
        content: doc('hi'),
        metadata: { title: 'Hello', n: 3 },
        baseSha: 'abc123',
      }
      const saved = await db.saveDraft(input)
      expect(saved).toMatchObject({
        collection: 'post',
        locale: 'en',
        slug: 'hello',
        content: doc('hi'),
        metadata: { title: 'Hello', n: 3 },
        baseSha: 'abc123',
      })
      expect(saved.createdAt).toBeTypeOf('number')
      expect(saved.updatedAt).toBeTypeOf('number')
      expect(saved.updatedAt).toBeGreaterThanOrEqual(saved.createdAt)
      const got = await db.getDraft({ collection: 'post', locale: 'en', slug: 'hello' })
      expect(got).toEqual(saved)
    })

    it('defaults baseSha to null when omitted', async () => {
      const saved = await db.saveDraft({
        collection: 'post',
        locale: 'en',
        slug: 'no-sha',
        content: doc('x'),
        metadata: {},
      })
      expect(saved.baseSha).toBeNull()
    })

    it('upserts on the same ref: updates content, bumps updatedAt, keeps createdAt', async () => {
      const ref = { collection: 'post', locale: 'en', slug: 'up' }
      const first = await db.saveDraft({ ...ref, content: doc('one'), metadata: {} })
      const second = await db.saveDraft({ ...ref, content: doc('two'), metadata: { edited: true } })
      expect(second.createdAt).toBe(first.createdAt)
      expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt)
      expect(second.content).toEqual(doc('two'))
      expect(second.metadata).toEqual({ edited: true })
      const all = await db.listDrafts()
      expect(all.filter((d) => d.slug === 'up')).toHaveLength(1)
    })

    it('deletes a draft; deleting an absent draft is a no-op', async () => {
      const ref = { collection: 'post', locale: 'en', slug: 'del' }
      await db.saveDraft({ ...ref, content: doc('x'), metadata: {} })
      await db.deleteDraft(ref)
      expect(await db.getDraft(ref)).toBeNull()
      await expect(db.deleteDraft(ref)).resolves.toBeUndefined()
    })

    it('lists drafts and filters by collection', async () => {
      // listDrafts return order is unspecified; adapters must not be assumed to order rows.
      await db.saveDraft({ collection: 'post', locale: 'en', slug: 'a', content: doc('a'), metadata: {} })
      await db.saveDraft({ collection: 'page', locale: 'en', slug: 'b', content: doc('b'), metadata: {} })
      expect(await db.listDrafts()).toHaveLength(2)
      const posts = await db.listDrafts({ collection: 'post' })
      expect(posts).toHaveLength(1)
      expect(posts[0]!.slug).toBe('a')
    })

    it('isolates entries by full ref (same slug, different locale)', async () => {
      await db.saveDraft({ collection: 'post', locale: 'en', slug: 'same', content: doc('english'), metadata: {} })
      await db.saveDraft({ collection: 'post', locale: 'fr', slug: 'same', content: doc('french'), metadata: {} })
      const en = await db.getDraft({ collection: 'post', locale: 'en', slug: 'same' })
      const fr = await db.getDraft({ collection: 'post', locale: 'fr', slug: 'same' })
      expect(en!.content).toEqual(doc('english'))
      expect(fr!.content).toEqual(doc('french'))
      expect(await db.listDrafts()).toHaveLength(2)
    })

    // --- locks ---
    it('returns null for an absent lock', async () => {
      expect(await db.getLock({ collection: 'post', locale: 'en', slug: 'x' })).toBeNull()
    })

    it('puts and reads a lock', async () => {
      const lock = { collection: 'post', locale: 'en', slug: 'l', lockedBy: 'sarah@x.com', lockedAt: 1000 }
      await db.putLock(lock)
      expect(await db.getLock({ collection: 'post', locale: 'en', slug: 'l' })).toEqual(lock)
    })

    it('overwrites a lock on repeated put (last write wins)', async () => {
      const ref = { collection: 'post', locale: 'en', slug: 'l' }
      await db.putLock({ ...ref, lockedBy: 'a@x.com', lockedAt: 1 })
      await db.putLock({ ...ref, lockedBy: 'b@x.com', lockedAt: 2 })
      expect(await db.getLock(ref)).toEqual({ ...ref, lockedBy: 'b@x.com', lockedAt: 2 })
    })

    it('deletes a lock; deleting an absent lock is a no-op', async () => {
      const ref = { collection: 'post', locale: 'en', slug: 'l' }
      await db.putLock({ ...ref, lockedBy: 'a@x.com', lockedAt: 1 })
      await db.deleteLock(ref)
      expect(await db.getLock(ref)).toBeNull()
      await expect(db.deleteLock(ref)).resolves.toBeUndefined()
    })
  })
}

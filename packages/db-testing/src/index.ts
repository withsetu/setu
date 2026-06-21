import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DataPort, TiptapDoc, IndexPort, EntryIndexRow, MediaIndexPort, MediaIndexRow } from '@setu/core'

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

const irow = (over: Partial<EntryIndexRow>): EntryIndexRow => {
  const base = {
    collection: 'post', locale: 'en', slug: 'x', title: 'X',
    status: 'draft' as const, updatedAt: 0, hasDraft: true, tags: [] as string[], categories: [] as string[], mediaRefs: [] as string[],
    ...over,
  }
  return { ...base, key: `${base.collection}\0${base.locale}\0${base.slug}`, titleLower: base.title.toLowerCase() }
}

export function runIndexPortContract(makeAdapter: () => Promise<IndexPort> | IndexPort): void {
  describe('IndexPort contract', () => {
    let ix: IndexPort
    beforeEach(async () => {
      ix = await makeAdapter()
    })

    it('upserts and queries back a row', async () => {
      await ix.upsert(irow({ slug: 'a', title: 'Alpha' }))
      const r = await ix.query({ collection: 'post', offset: 0, limit: 10 })
      expect(r.total).toBe(1)
      expect(r.rows[0]!.slug).toBe('a')
    })

    it('upsertMany, filters by status, paginates with total', async () => {
      await ix.upsertMany([
        irow({ slug: 'a', status: 'live', updatedAt: 3 }),
        irow({ slug: 'b', status: 'draft', updatedAt: 2 }),
        irow({ slug: 'c', status: 'draft', updatedAt: 1 }),
      ])
      const drafts = await ix.query({ collection: 'post', status: 'draft', offset: 0, limit: 1 })
      expect(drafts.total).toBe(2)
      expect(drafts.rows).toHaveLength(1)
      expect(drafts.rows[0]!.slug).toBe('b') // updatedAt desc
    })

    it('remove and clear', async () => {
      await ix.upsertMany([irow({ slug: 'a' }), irow({ slug: 'b' })])
      await ix.remove('post\0en\0a')
      expect((await ix.query({ collection: 'post', offset: 0, limit: 10 })).total).toBe(1)
      await ix.clear()
      expect((await ix.query({ collection: 'post', offset: 0, limit: 10 })).total).toBe(0)
    })

    it('meta round-trips and defaults to null/0', async () => {
      expect(await ix.getMeta()).toEqual({ indexedSha: null, version: 0 })
      await ix.setMeta({ indexedSha: 'abc', version: 2 })
      expect(await ix.getMeta()).toEqual({ indexedSha: 'abc', version: 2 })
    })

    it('distinctTags: prefix-filters, dedupes across rows, sorts, respects limit', async () => {
      await ix.upsertMany([
        irow({ slug: 'a', tags: ['react', 'nextjs'] }),
        irow({ slug: 'b', tags: ['react', 'redux'] }),
        irow({ slug: 'c', tags: ['vue'] }),
      ])
      expect(await ix.distinctTags('re', 10)).toEqual(['react', 'redux'])
      expect(await ix.distinctTags('', 2)).toEqual(['nextjs', 'react'])
      expect(await ix.distinctTags('zzz', 10)).toEqual([])
    })

    it('distinctLocales: returns distinct locales sorted', async () => {
      await ix.upsertMany([
        irow({ slug: 'a', locale: 'fr' }),
        irow({ slug: 'b', locale: 'en' }),
        irow({ slug: 'c', locale: 'en' }),
      ])
      expect(await ix.distinctLocales()).toEqual(['en', 'fr'])
    })
  })
}

const mrow = (over: Partial<MediaIndexRow>): MediaIndexRow => {
  const base = {
    mediaKey: '2026/06/x', key: '2026/06/x.jpg', thumbKey: null as string | null,
    filename: 'x.jpg', contentType: 'image/jpeg', isImage: true,
    width: null as number | null, height: null as number | null, bytes: 0, uploadedAt: 0,
    ...over,
  }
  return { ...base, filenameLower: base.filename.toLowerCase() }
}

export function runMediaIndexPortContract(makeAdapter: () => Promise<MediaIndexPort> | MediaIndexPort): void {
  describe('MediaIndexPort contract', () => {
    let ix: MediaIndexPort
    beforeEach(async () => { ix = await makeAdapter() })

    it('upserts and queries back a row', async () => {
      await ix.upsert(mrow({ mediaKey: 'a', filename: 'Alpha.jpg' }))
      const r = await ix.query({ offset: 0, limit: 10 })
      expect(r.total).toBe(1)
      expect(r.rows[0]!.mediaKey).toBe('a')
    })
    it('upsertMany, sorts uploadedAt desc, paginates with total', async () => {
      await ix.upsertMany([mrow({ mediaKey: 'a', uploadedAt: 1 }), mrow({ mediaKey: 'b', uploadedAt: 3 }), mrow({ mediaKey: 'c', uploadedAt: 2 })])
      const r = await ix.query({ offset: 0, limit: 2 })
      expect(r.total).toBe(3)
      expect(r.rows.map((x) => x.mediaKey)).toEqual(['b', 'c'])
    })
    it('filters by type=image', async () => {
      await ix.upsertMany([mrow({ mediaKey: 'img', isImage: true }), mrow({ mediaKey: 'doc', isImage: false })])
      const r = await ix.query({ type: 'image', offset: 0, limit: 10 })
      expect(r.rows.map((x) => x.mediaKey)).toEqual(['img'])
    })
    it('remove and clear', async () => {
      await ix.upsertMany([mrow({ mediaKey: 'a' }), mrow({ mediaKey: 'b' })])
      await ix.remove('a')
      expect((await ix.query({ offset: 0, limit: 10 })).total).toBe(1)
      await ix.clear()
      expect((await ix.query({ offset: 0, limit: 10 })).total).toBe(0)
    })
    it('meta round-trips and defaults to version 0', async () => {
      expect(await ix.getMeta()).toEqual({ version: 0 })
      await ix.setMeta({ version: 2 })
      expect(await ix.getMeta()).toEqual({ version: 2 })
    })
  })
}

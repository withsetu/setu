import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type {
  DataPort,
  TiptapDoc,
  IndexPort,
  EntryIndexRow,
  MediaIndexPort,
  MediaIndexRow,
  SubmissionPort,
  CaptchaPort
} from '@setu/core'

const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
})

/** Run the DataPort behavioral contract against an adapter. `makeAdapter` must
 *  return a FRESH, empty adapter (e.g. a new in-memory DB) on each call. */
export function runDataPortContract(
  makeAdapter: () => Promise<DataPort> | DataPort
): void {
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
      expect(
        await db.getDraft({ collection: 'post', locale: 'en', slug: 'x' })
      ).toBeNull()
    })

    it('saves and reads back a draft, round-tripping content/metadata/baseSha', async () => {
      const input = {
        collection: 'post',
        locale: 'en',
        slug: 'hello',
        content: doc('hi'),
        metadata: { title: 'Hello', n: 3 },
        baseSha: 'abc123'
      }
      const saved = await db.saveDraft(input)
      expect(saved).toMatchObject({
        collection: 'post',
        locale: 'en',
        slug: 'hello',
        content: doc('hi'),
        metadata: { title: 'Hello', n: 3 },
        baseSha: 'abc123'
      })
      expect(saved.createdAt).toBeTypeOf('number')
      expect(saved.updatedAt).toBeTypeOf('number')
      expect(saved.updatedAt).toBeGreaterThanOrEqual(saved.createdAt)
      const got = await db.getDraft({
        collection: 'post',
        locale: 'en',
        slug: 'hello'
      })
      expect(got).toEqual(saved)
    })

    it('defaults baseSha to null when omitted', async () => {
      const saved = await db.saveDraft({
        collection: 'post',
        locale: 'en',
        slug: 'no-sha',
        content: doc('x'),
        metadata: {}
      })
      expect(saved.baseSha).toBeNull()
    })

    it('upserts on the same ref: updates content, bumps updatedAt, keeps createdAt', async () => {
      const ref = { collection: 'post', locale: 'en', slug: 'up' }
      const first = await db.saveDraft({
        ...ref,
        content: doc('one'),
        metadata: {}
      })
      const second = await db.saveDraft({
        ...ref,
        content: doc('two'),
        metadata: { edited: true }
      })
      expect(second.createdAt).toBe(first.createdAt)
      expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt)
      expect(second.content).toEqual(doc('two'))
      expect(second.metadata).toEqual({ edited: true })
      const all = await db.listDrafts()
      expect(all.filter((d) => d.slug === 'up')).toHaveLength(1)
    })

    // #261: baseContent is the per-file publish-conflict base (fork reference).
    it('round-trips baseContent and defaults it to null when omitted on first save', async () => {
      const base = '---\ntitle: X\n---\n\nBody\n'
      const saved = await db.saveDraft({
        collection: 'post',
        locale: 'en',
        slug: 'bc',
        content: doc('x'),
        metadata: {},
        baseContent: base
      })
      expect(saved.baseContent).toBe(base)
      const got = await db.getDraft({
        collection: 'post',
        locale: 'en',
        slug: 'bc'
      })
      expect(got!.baseContent).toBe(base)
      const fresh = await db.saveDraft({
        collection: 'post',
        locale: 'en',
        slug: 'bc-fresh',
        content: doc('y'),
        metadata: {}
      })
      expect(fresh.baseContent).toBeNull()
    })

    it('omitting baseContent on upsert preserves it; explicit null clears it', async () => {
      const ref = { collection: 'post', locale: 'en', slug: 'bc-up' }
      await db.saveDraft({
        ...ref,
        content: doc('one'),
        metadata: {},
        baseContent: 'BASE'
      })
      // Editing (no baseContent in the input) must not move the fork point.
      const preserved = await db.saveDraft({
        ...ref,
        content: doc('two'),
        metadata: {}
      })
      expect(preserved.baseContent).toBe('BASE')
      expect(
        (await db.getDraft(ref))!.baseContent // read path agrees
      ).toBe('BASE')
      // Explicit null (e.g. re-fork of a never-committed entry) overwrites.
      const cleared = await db.saveDraft({
        ...ref,
        content: doc('three'),
        metadata: {},
        baseContent: null
      })
      expect(cleared.baseContent).toBeNull()
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
      await db.saveDraft({
        collection: 'post',
        locale: 'en',
        slug: 'a',
        content: doc('a'),
        metadata: {}
      })
      await db.saveDraft({
        collection: 'page',
        locale: 'en',
        slug: 'b',
        content: doc('b'),
        metadata: {}
      })
      expect(await db.listDrafts()).toHaveLength(2)
      const posts = await db.listDrafts({ collection: 'post' })
      expect(posts).toHaveLength(1)
      expect(posts[0]!.slug).toBe('a')
    })

    it('isolates entries by full ref (same slug, different locale)', async () => {
      await db.saveDraft({
        collection: 'post',
        locale: 'en',
        slug: 'same',
        content: doc('english'),
        metadata: {}
      })
      await db.saveDraft({
        collection: 'post',
        locale: 'fr',
        slug: 'same',
        content: doc('french'),
        metadata: {}
      })
      const en = await db.getDraft({
        collection: 'post',
        locale: 'en',
        slug: 'same'
      })
      const fr = await db.getDraft({
        collection: 'post',
        locale: 'fr',
        slug: 'same'
      })
      expect(en!.content).toEqual(doc('english'))
      expect(fr!.content).toEqual(doc('french'))
      expect(await db.listDrafts()).toHaveLength(2)
    })

    // --- locks ---
    it('returns null for an absent lock', async () => {
      expect(
        await db.getLock({ collection: 'post', locale: 'en', slug: 'x' })
      ).toBeNull()
    })

    it('puts and reads a lock', async () => {
      const lock = {
        collection: 'post',
        locale: 'en',
        slug: 'l',
        lockedBy: 'sarah@x.com',
        lockedAt: 1000
      }
      await db.putLock(lock)
      expect(
        await db.getLock({ collection: 'post', locale: 'en', slug: 'l' })
      ).toEqual(lock)
    })

    it('overwrites a lock on repeated put (last write wins)', async () => {
      const ref = { collection: 'post', locale: 'en', slug: 'l' }
      await db.putLock({ ...ref, lockedBy: 'a@x.com', lockedAt: 1 })
      await db.putLock({ ...ref, lockedBy: 'b@x.com', lockedAt: 2 })
      expect(await db.getLock(ref)).toEqual({
        ...ref,
        lockedBy: 'b@x.com',
        lockedAt: 2
      })
    })

    it('deletes a lock; deleting an absent lock is a no-op', async () => {
      const ref = { collection: 'post', locale: 'en', slug: 'l' }
      await db.putLock({ ...ref, lockedBy: 'a@x.com', lockedAt: 1 })
      await db.deleteLock(ref)
      expect(await db.getLock(ref)).toBeNull()
      await expect(db.deleteLock(ref)).resolves.toBeUndefined()
    })

    it('listLocks returns all held locks; empty when none; drops deleted', async () => {
      expect(await db.listLocks()).toEqual([])
      await db.putLock({
        collection: 'post',
        locale: 'en',
        slug: 'a',
        lockedBy: 'sarah@x.com',
        lockedAt: 1
      })
      await db.putLock({
        collection: 'page',
        locale: 'en',
        slug: 'b',
        lockedBy: 'omar@x.com',
        lockedAt: 2
      })
      const locks = await db.listLocks()
      expect(locks).toHaveLength(2)
      expect(locks.map((l) => l.slug).sort()).toEqual(['a', 'b'])
      await db.deleteLock({ collection: 'post', locale: 'en', slug: 'a' })
      expect((await db.listLocks()).map((l) => l.slug)).toEqual(['b'])
    })
  })
}

const irow = (over: Partial<EntryIndexRow>): EntryIndexRow => {
  const base = {
    collection: 'post',
    locale: 'en',
    slug: 'x',
    title: 'X',
    status: 'draft' as const,
    updatedAt: 0,
    hasDraft: true,
    date: null as number | null,
    tags: [] as string[],
    categories: [] as string[],
    mediaRefs: [] as string[],
    ...over
  }
  return {
    ...base,
    key: `${base.collection}\0${base.locale}\0${base.slug}`,
    titleLower: base.title.toLowerCase()
  }
}

export function runIndexPortContract(
  makeAdapter: () => Promise<IndexPort> | IndexPort
): void {
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
        irow({ slug: 'c', status: 'draft', updatedAt: 1 })
      ])
      const drafts = await ix.query({
        collection: 'post',
        status: 'draft',
        offset: 0,
        limit: 1
      })
      expect(drafts.total).toBe(2)
      expect(drafts.rows).toHaveLength(1)
      expect(drafts.rows[0]!.slug).toBe('b') // updatedAt desc
    })

    it('stats: empty index → no collections', async () => {
      expect(await ix.stats()).toEqual({})
    })

    it('stats: per-collection lifecycle tallies across mixed statuses', async () => {
      await ix.upsertMany([
        irow({ slug: 'a', collection: 'post', status: 'live' }),
        irow({ slug: 'b', collection: 'post', status: 'live' }),
        irow({ slug: 'c', collection: 'post', status: 'staged' }),
        irow({ slug: 'd', collection: 'post', status: 'draft' }),
        irow({ slug: 'e', collection: 'post', status: 'unpublished' }),
        irow({ slug: 'about', collection: 'page', status: 'live' }),
        irow({ slug: 'contact', collection: 'page', status: 'draft' })
      ])
      expect(await ix.stats()).toEqual({
        post: { total: 5, draft: 1, staged: 1, live: 2, unpublished: 1 },
        page: { total: 2, draft: 1, staged: 0, live: 1, unpublished: 0 }
      })
    })

    it('remove and clear', async () => {
      await ix.upsertMany([irow({ slug: 'a' }), irow({ slug: 'b' })])
      await ix.remove('post\0en\0a')
      expect(
        (await ix.query({ collection: 'post', offset: 0, limit: 10 })).total
      ).toBe(1)
      await ix.clear()
      expect(
        (await ix.query({ collection: 'post', offset: 0, limit: 10 })).total
      ).toBe(0)
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
        irow({ slug: 'c', tags: ['vue'] })
      ])
      expect(await ix.distinctTags('re', 10)).toEqual(['react', 'redux'])
      expect(await ix.distinctTags('', 2)).toEqual(['nextjs', 'react'])
      expect(await ix.distinctTags('zzz', 10)).toEqual([])
    })

    it('distinctLocales: returns distinct locales sorted', async () => {
      await ix.upsertMany([
        irow({ slug: 'a', locale: 'fr' }),
        irow({ slug: 'b', locale: 'en' }),
        irow({ slug: 'c', locale: 'en' })
      ])
      expect(await ix.distinctLocales()).toEqual(['en', 'fr'])
    })

    it('categoryCounts tallies usage across rows', async () => {
      const port = ix
      await port.upsertMany([
        { ...irow({ slug: 'a' }), categories: ['eng', 'news'] },
        { ...irow({ slug: 'b' }), categories: ['eng'] }
      ])
      expect(await port.categoryCounts()).toEqual({ eng: 2, news: 1 })
    })

    it('tagCounts tallies usage across rows', async () => {
      await ix.upsertMany([
        { ...irow({ slug: 'a' }), tags: ['react', 'css'] },
        { ...irow({ slug: 'b' }), tags: ['react'] }
      ])
      expect(await ix.tagCounts()).toEqual({ react: 2, css: 1 })
    })

    it('referencedBy: returns entries whose mediaRefs include the key', async () => {
      await ix.upsertMany([
        irow({ slug: 'a', title: 'A', mediaRefs: ['2026/06/cat'] }),
        irow({ slug: 'b', title: 'B', mediaRefs: ['2026/06/dog'] }),
        irow({
          slug: 'c',
          title: 'C',
          mediaRefs: ['2026/06/cat', '2026/06/dog']
        })
      ])
      const used = await ix.referencedBy('2026/06/cat')
      expect(used.map((u) => u.slug).sort()).toEqual(['a', 'c'])
      expect(used[0]).toHaveProperty('title')
      expect(await ix.referencedBy('2026/06/none')).toEqual([])
    })

    it('entriesByCategory: returns refs of entries whose categories include the slug', async () => {
      await ix.upsertMany([
        { ...irow({ slug: 'a', collection: 'post' }), categories: ['eng'] },
        {
          ...irow({ slug: 'b', collection: 'page' }),
          categories: ['eng', 'news']
        },
        { ...irow({ slug: 'c', collection: 'post' }), categories: ['news'] }
      ])
      const refs = await ix.entriesByCategory('eng')
      expect(refs.map((r) => r.slug).sort()).toEqual(['a', 'b'])
      expect(refs[0]).toMatchObject({
        collection: expect.any(String),
        locale: expect.any(String),
        slug: expect.any(String)
      })
      expect(await ix.entriesByCategory('unknown')).toEqual([])
    })

    it('entriesByTag: returns refs of entries whose tags include the tag', async () => {
      await ix.upsertMany([
        irow({ slug: 'a', collection: 'post', tags: ['react'] }),
        irow({ slug: 'b', collection: 'page', tags: ['react', 'css'] }),
        irow({ slug: 'c', collection: 'post', tags: ['css'] })
      ])
      const refs = await ix.entriesByTag('react')
      expect(refs.map((r) => r.slug).sort()).toEqual(['a', 'b'])
      expect(refs[0]).toMatchObject({
        collection: expect.any(String),
        locale: expect.any(String),
        slug: expect.any(String)
      })
      expect(await ix.entriesByTag('unknown')).toEqual([])
    })
  })
}

const mrow = (over: Partial<MediaIndexRow>): MediaIndexRow => {
  const base = {
    mediaKey: '2026/06/x',
    key: '2026/06/x.jpg',
    thumbKey: null as string | null,
    filename: 'x.jpg',
    contentType: 'image/jpeg',
    isImage: true,
    width: null as number | null,
    height: null as number | null,
    bytes: 0,
    uploadedAt: 0,
    ...over
  }
  return { ...base, filenameLower: base.filename.toLowerCase() }
}

export function runMediaIndexPortContract(
  makeAdapter: () => Promise<MediaIndexPort> | MediaIndexPort
): void {
  describe('MediaIndexPort contract', () => {
    let ix: MediaIndexPort
    beforeEach(async () => {
      ix = await makeAdapter()
    })

    it('upserts and queries back a row', async () => {
      await ix.upsert(mrow({ mediaKey: 'a', filename: 'Alpha.jpg' }))
      const r = await ix.query({ offset: 0, limit: 10 })
      expect(r.total).toBe(1)
      expect(r.rows[0]!.mediaKey).toBe('a')
    })
    it('upsertMany, sorts uploadedAt desc, paginates with total', async () => {
      await ix.upsertMany([
        mrow({ mediaKey: 'a', uploadedAt: 1 }),
        mrow({ mediaKey: 'b', uploadedAt: 3 }),
        mrow({ mediaKey: 'c', uploadedAt: 2 })
      ])
      const r = await ix.query({ offset: 0, limit: 2 })
      expect(r.total).toBe(3)
      expect(r.rows.map((x) => x.mediaKey)).toEqual(['b', 'c'])
    })
    it('filters by media kind (image vs document)', async () => {
      await ix.upsertMany([
        mrow({ mediaKey: 'img', contentType: 'image/png' }),
        mrow({
          mediaKey: 'doc',
          isImage: false,
          contentType: 'application/pdf'
        })
      ])
      expect(
        (await ix.query({ type: 'image', offset: 0, limit: 10 })).rows.map(
          (x) => x.mediaKey
        )
      ).toEqual(['img'])
      expect(
        (await ix.query({ type: 'document', offset: 0, limit: 10 })).rows.map(
          (x) => x.mediaKey
        )
      ).toEqual(['doc'])
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

/** Run the SubmissionPort behavioral contract against an adapter. `makeAdapter`
 *  must return a FRESH, empty adapter on each call. */
export function runSubmissionPortContract(
  makeAdapter: () => Promise<SubmissionPort> | SubmissionPort
): void {
  describe('SubmissionPort contract', () => {
    let db: SubmissionPort
    beforeEach(async () => {
      db = await makeAdapter()
    })
    afterEach(async () => {
      await db.close()
    })

    const input = (
      over: Partial<Parameters<SubmissionPort['saveSubmission']>[0]> = {}
    ) => ({
      formId: 'contact',
      formLabel: 'Contact',
      fields: { name: 'Ada', email: 'ada@x.com', message: 'hi' },
      ...over
    })

    it('assigns id + createdAt, defaults read=false, round-trips fields', async () => {
      const saved = await db.saveSubmission(input())
      expect(saved.id).toBeTypeOf('string')
      expect(saved.id.length).toBeGreaterThan(0)
      expect(saved.createdAt).toBeTypeOf('number')
      expect(saved.read).toBe(false)
      expect(saved.fields).toEqual({
        name: 'Ada',
        email: 'ada@x.com',
        message: 'hi'
      })
      expect(await db.getSubmission(saved.id)).toEqual(saved)
    })

    it('returns null for an absent id', async () => {
      expect(await db.getSubmission('nope')).toBeNull()
    })

    it('lists newest-first with total', async () => {
      const a = await db.saveSubmission(
        input({ fields: { email: 'a@x.com', message: 'first' } })
      )
      await new Promise<void>((r) => setTimeout(r, 2))
      const b = await db.saveSubmission(
        input({ fields: { email: 'b@x.com', message: 'second' } })
      )
      const { rows, total } = await db.listSubmissions()
      expect(total).toBe(2)
      expect(rows.map((r) => r.id)).toEqual([b.id, a.id]) // newest first
    })

    it('filters by formId and by read', async () => {
      const c = await db.saveSubmission(input({ formId: 'contact' }))
      await db.saveSubmission(input({ formId: 'apply' }))
      await db.setRead([c.id], true)
      expect((await db.listSubmissions({ formId: 'apply' })).total).toBe(1)
      expect(
        (await db.listSubmissions({ read: true })).rows.map((r) => r.id)
      ).toEqual([c.id])
      expect((await db.listSubmissions({ read: false })).total).toBe(1)
    })

    it('searches q over field values (case-insensitive substring)', async () => {
      await db.saveSubmission(
        input({ fields: { email: 'a@x.com', message: 'Need a QUOTE please' } })
      )
      await db.saveSubmission(
        input({ fields: { email: 'b@x.com', message: 'just saying hi' } })
      )
      const { rows, total } = await db.listSubmissions({ q: 'quote' })
      expect(total).toBe(1)
      expect(rows[0]!.fields.message).toContain('QUOTE')
    })

    it('q matches field values only, not field keys', async () => {
      await db.saveSubmission(
        input({ fields: { email: 'a@x.com', message: 'hello' } })
      )
      expect((await db.listSubmissions({ q: 'email' })).total).toBe(0) // 'email' is a key, not in any value
      expect((await db.listSubmissions({ q: 'hello' })).total).toBe(1) // value substring matches
    })

    it('paginates with limit/offset while total stays unpaged', async () => {
      for (let i = 0; i < 5; i++)
        await db.saveSubmission(
          input({ fields: { email: `u${i}@x.com`, message: `m${i}` } })
        )
      const page = await db.listSubmissions({ limit: 2, offset: 2 })
      expect(page.total).toBe(5)
      expect(page.rows).toHaveLength(2)
    })

    it('setRead is idempotent and ignores unknown ids', async () => {
      const a = await db.saveSubmission(input())
      await db.setRead([a.id, 'ghost'], true)
      await db.setRead([a.id], true)
      expect((await db.getSubmission(a.id))!.read).toBe(true)
      await db.setRead([a.id], false)
      expect((await db.getSubmission(a.id))!.read).toBe(false)
    })

    it('deletes in bulk and ignores unknown ids', async () => {
      const a = await db.saveSubmission(input())
      const b = await db.saveSubmission(input())
      await db.deleteSubmissions([a.id, 'ghost'])
      expect(await db.getSubmission(a.id)).toBeNull()
      expect((await db.listSubmissions()).total).toBe(1)
      expect((await db.listSubmissions()).rows[0]!.id).toBe(b.id)
    })

    it('distinctForms groups with counts, newest label wins', async () => {
      await db.saveSubmission(
        input({ formId: 'contact', formLabel: 'Contact' })
      )
      await new Promise<void>((r) => setTimeout(r, 2))
      await db.saveSubmission(
        input({ formId: 'contact', formLabel: 'Contact Us' })
      )
      await db.saveSubmission(input({ formId: 'apply', formLabel: 'Apply' }))
      expect(await db.distinctForms()).toEqual([
        { formId: 'apply', formLabel: 'Apply', count: 1 },
        { formId: 'contact', formLabel: 'Contact Us', count: 2 }
      ])
    })
  })
}

/** Behavioral contract for any CaptchaPort adapter. `makeAdapter` builds the
 *  adapter with an injected fetch so the harness controls the provider response. */
export function runCaptchaPortContract(
  makeAdapter: (fetchImpl: typeof fetch) => CaptchaPort
): void {
  const fakeFetch =
    (status: number, body: unknown): typeof fetch =>
    async () =>
      new Response(JSON.stringify(body), { status })

  describe('CaptchaPort contract', () => {
    it('returns true when the provider reports success', async () => {
      expect(
        await makeAdapter(fakeFetch(200, { success: true })).verify('tok')
      ).toBe(true)
    })
    it('returns false when the provider reports failure', async () => {
      expect(
        await makeAdapter(fakeFetch(200, { success: false })).verify('tok')
      ).toBe(false)
    })
    it('returns false on a non-OK HTTP status (fail-closed)', async () => {
      expect(await makeAdapter(fakeFetch(500, {})).verify('tok')).toBe(false)
    })
    it('returns false when the request throws (fail-closed)', async () => {
      const throwing = (() =>
        Promise.reject(new Error('net'))) as unknown as typeof fetch
      expect(await makeAdapter(throwing).verify('tok')).toBe(false)
    })
  })
}

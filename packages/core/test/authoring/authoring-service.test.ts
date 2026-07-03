import { describe, it, expect, beforeEach } from 'vitest'
import { createAuthoringService, DEFAULT_LOCK_TTL_MS } from '../../src/index'
import type {
  DataPort,
  Draft,
  EntryRef,
  Lock,
  TiptapDoc
} from '../../src/index'

const key = (r: EntryRef) => `${r.collection} ${r.locale} ${r.slug}`
const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
})

/** Minimal in-memory DataPort for testing the service (no cross-package dep). */
function fakeDataPort(): DataPort {
  const drafts = new Map<string, Draft>()
  const locks = new Map<string, Lock>()
  return {
    async getDraft(ref) {
      return drafts.get(key(ref)) ?? null
    },
    async saveDraft(input) {
      const k = key(input)
      const existing = drafts.get(k)
      const d: Draft = {
        collection: input.collection,
        locale: input.locale,
        slug: input.slug,
        content: input.content,
        metadata: input.metadata,
        baseSha: input.baseSha ?? null,
        createdAt: existing?.createdAt ?? 0,
        updatedAt: 0
      }
      drafts.set(k, d)
      return d
    },
    async deleteDraft(ref) {
      drafts.delete(key(ref))
    },
    async listDrafts(filter) {
      const all = [...drafts.values()]
      return filter?.collection
        ? all.filter((d) => d.collection === filter.collection)
        : all
    },
    async getLock(ref) {
      return locks.get(key(ref)) ?? null
    },
    async putLock(lock) {
      locks.set(key(lock), { ...lock })
    },
    async deleteLock(ref) {
      locks.delete(key(ref))
    },
    async close() {}
  }
}

describe('createAuthoringService', () => {
  let data: DataPort
  let clock: number
  const now = () => clock
  const ref: EntryRef = { collection: 'post', locale: 'en', slug: 'hello' }
  const svc = () => createAuthoringService({ data, now, lockTtlMs: 1000 })

  beforeEach(() => {
    data = fakeDataPort()
    clock = 5000
  })

  it('open on a free entry acquires the lock', async () => {
    const r = await svc().open(ref, 'a@x.com')
    expect(r).toMatchObject({ granted: true, outcome: 'acquired' })
    expect(r.lock).toEqual({ ...ref, lockedBy: 'a@x.com', lockedAt: 5000 })
    expect(r.draft).toBeNull()
  })

  it('open by the same editor later refreshes and advances lockedAt', async () => {
    const s = svc()
    await s.open(ref, 'a@x.com')
    clock = 5400
    const r = await s.open(ref, 'a@x.com')
    expect(r.outcome).toBe('refreshed')
    expect(r.lock.lockedAt).toBe(5400)
  })

  it('open by another editor while fresh is blocked and returns the draft read-only', async () => {
    const s = svc()
    await s.save({ ...ref, content: doc('hi'), metadata: {} }, 'a@x.com')
    clock = 5500 // age 500 <= ttl 1000 → fresh
    const r = await s.open(ref, 'b@x.com')
    expect(r.granted).toBe(false)
    expect(r.outcome).toBe('blocked')
    expect(r.lock.lockedBy).toBe('a@x.com')
    expect(r.draft?.content).toEqual(doc('hi'))
  })

  it('open by another editor after TTL takes over', async () => {
    const s = svc()
    await s.open(ref, 'a@x.com') // locked at 5000
    clock = 6001 // age 1001 > 1000
    const r = await s.open(ref, 'b@x.com')
    expect(r.outcome).toBe('tookOver')
    expect(r.lock.lockedBy).toBe('b@x.com')
  })

  it('save persists the draft and refreshes the lock', async () => {
    const r = await svc().save(
      { ...ref, content: doc('v1'), metadata: { title: 'T' } },
      'a@x.com'
    )
    expect(r.saved).toBe(true)
    expect(r.draft?.content).toEqual(doc('v1'))
    expect(await data.getLock(ref)).toMatchObject({
      lockedBy: 'a@x.com',
      lockedAt: 5000
    })
  })

  it('save blocked by another fresh editor does NOT persist', async () => {
    const s = svc()
    await s.open(ref, 'a@x.com') // a holds a fresh lock at 5000
    clock = 5200
    const r = await s.save(
      { ...ref, content: doc('intruder'), metadata: {} },
      'b@x.com'
    )
    expect(r.saved).toBe(false)
    expect(r.outcome).toBe('blocked')
    expect(await data.getDraft(ref)).toBeNull() // nothing was written
  })

  it('release by the holder removes the lock; by a non-holder does not', async () => {
    const s = svc()
    await s.open(ref, 'a@x.com')
    expect(await s.release(ref, 'b@x.com')).toEqual({ released: false })
    expect(await data.getLock(ref)).not.toBeNull()
    expect(await s.release(ref, 'a@x.com')).toEqual({ released: true })
    expect(await data.getLock(ref)).toBeNull()
  })

  it('forceUnlock removes the lock regardless of holder', async () => {
    const s = svc()
    await s.open(ref, 'a@x.com')
    await s.forceUnlock(ref)
    expect(await data.getLock(ref)).toBeNull()
  })

  it('status reports null / fresh / stale', async () => {
    const s = svc()
    expect(await s.status(ref)).toBeNull()
    await s.open(ref, 'a@x.com') // locked at 5000
    clock = 5500
    expect(await s.status(ref)).toEqual({
      lock: { ...ref, lockedBy: 'a@x.com', lockedAt: 5000 },
      stale: false
    })
    clock = 6001
    expect((await s.status(ref))?.stale).toBe(true)
  })

  it('release when no lock exists returns released:false', async () => {
    const r = await svc().release(ref, 'a@x.com')
    expect(r).toEqual({ released: false })
  })

  it('save by a third editor against a stale lock takes over and persists', async () => {
    const s = svc()
    await s.open(ref, 'a@x.com') // a locked at 5000
    clock = 6001 // a's lock now stale (age 1001 > ttl 1000)
    const r = await s.save(
      { ...ref, content: doc('c-edit'), metadata: {} },
      'c@x.com'
    )
    expect(r.saved).toBe(true)
    expect(r.outcome).toBe('tookOver')
    expect(r.lock.lockedBy).toBe('c@x.com')
    expect((await data.getDraft(ref))?.content).toEqual(doc('c-edit'))
  })

  it('defaults lockTtlMs to DEFAULT_LOCK_TTL_MS', async () => {
    const s = createAuthoringService({ data, now })
    await s.open(ref, 'a@x.com') // locked at 5000
    clock = 5000 + DEFAULT_LOCK_TTL_MS // age === ttl → fresh
    expect((await s.status(ref))?.stale).toBe(false)
    clock = 5000 + DEFAULT_LOCK_TTL_MS + 1 // age > ttl → stale
    expect((await s.status(ref))?.stale).toBe(true)
  })
})

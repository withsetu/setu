import type { DataPort, Draft, DraftInput, EntryRef, Lock } from '@saytu/core'

const key = (r: EntryRef) => `${r.collection} ${r.locale} ${r.slug}`

/** An in-memory DataPort (Map-backed, browser-safe). Optionally seeded with
 *  drafts. Behavior matches the real adapters' contract (createdAt preserved on
 *  upsert, updatedAt bumped). Timestamps are a monotonic counter — deterministic
 *  and ordering-faithful, which is all the contract requires. */
export function createMemoryDataPort(seed: DraftInput[] = []): DataPort {
  const drafts = new Map<string, Draft>()
  const locks = new Map<string, Lock>()
  let clock = 0

  const put = (input: DraftInput): Draft => {
    const k = key(input)
    const now = ++clock
    const existing = drafts.get(k)
    const draft: Draft = {
      collection: input.collection,
      locale: input.locale,
      slug: input.slug,
      content: input.content,
      metadata: input.metadata,
      baseSha: input.baseSha ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    drafts.set(k, draft)
    return draft
  }

  for (const s of seed) put(s)

  return {
    async getDraft(ref) {
      return drafts.get(key(ref)) ?? null
    },
    async saveDraft(input) {
      return put(input)
    },
    async deleteDraft(ref) {
      drafts.delete(key(ref))
    },
    async listDrafts(filter) {
      const all = [...drafts.values()]
      return filter?.collection ? all.filter((d) => d.collection === filter.collection) : all
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
    async close() {},
  }
}

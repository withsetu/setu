import { runDataPortContract } from '../src/index'
import type { DataPort, Draft, EntryRef, Lock } from '@setu/core'

const key = (r: EntryRef) => `${r.collection} ${r.locale} ${r.slug}`

/** A correct in-memory DataPort — proves the contract suite passes a valid
 *  implementation (and would fail a broken one). Doubles as a reference. */
function createMemoryAdapter(): DataPort {
  const drafts = new Map<string, Draft>()
  const locks = new Map<string, Lock>()
  return {
    async getDraft(ref) {
      return drafts.get(key(ref)) ?? null
    },
    async saveDraft(input) {
      const k = key(input)
      const now = Date.now()
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
      // test double: stores/returns the same object reference (fine for tests; a
      // production in-memory adapter would clone to prevent caller mutation).
      drafts.set(k, draft)
      return draft
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

runDataPortContract(() => createMemoryAdapter())

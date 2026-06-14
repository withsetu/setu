import type { DataPort, Draft, DraftInput, EntryRef, Lock } from '@saytu/core'

// NUL separator: cannot appear in a collection/locale/slug, so refs never collide
// (unlike a space separator). Mirrors db-sqlite's composite-key uniqueness.
const key = (r: EntryRef) => `${r.collection}\0${r.locale}\0${r.slug}`

/** An in-memory DataPort (Map-backed, browser-safe). Optionally seeded with
 *  drafts. **Value semantics**: inputs are deep-cloned on write and reads return
 *  deep clones, so callers can never mutate the adapter's internal state through a
 *  returned object — matching db-sqlite (which round-trips through JSON).
 *  Timestamps are a monotonic counter — deterministic and ordering-faithful,
 *  which is all the DataPort contract requires. */
export function createMemoryDataPort(seed: DraftInput[] = []): DataPort {
  const drafts = new Map<string, Draft>()
  const locks = new Map<string, Lock>()
  let clock = 0

  const put = (input: DraftInput): Draft => {
    const k = key(input)
    const now = ++clock
    const existing = drafts.get(k)
    // structuredClone isolates the stored draft from the caller's input objects.
    const stored: Draft = structuredClone({
      collection: input.collection,
      locale: input.locale,
      slug: input.slug,
      content: input.content,
      metadata: input.metadata,
      baseSha: input.baseSha ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    drafts.set(k, stored)
    return structuredClone(stored)
  }

  for (const s of seed) put(s)

  return {
    async getDraft(ref) {
      const d = drafts.get(key(ref))
      return d ? structuredClone(d) : null
    },
    async saveDraft(input) {
      return put(input)
    },
    async deleteDraft(ref) {
      drafts.delete(key(ref))
    },
    async listDrafts(filter) {
      const all = [...drafts.values()]
      const filtered = filter?.collection ? all.filter((d) => d.collection === filter.collection) : all
      return filtered.map((d) => structuredClone(d))
    },
    async getLock(ref) {
      const l = locks.get(key(ref))
      return l ? { ...l } : null
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

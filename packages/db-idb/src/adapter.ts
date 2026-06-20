import { openDB } from 'idb'
import type { DataPort, Draft, DraftInput, EntryRef, Lock } from '@setu/core'

// NUL composite key — cannot appear in collection/locale/slug, so refs never collide.
const keyOf = (r: EntryRef): string => `${r.collection}\0${r.locale}\0${r.slug}`

/** An IndexedDB-backed DataPort (drafts + locks), behaviorally equivalent to
 *  db-memory (proven by runDataPortContract) but persistent across reloads.
 *  `dbName` is parameterized so tests get a fresh database per run. */
export async function createIdbDataPort(dbName = 'setu-data'): Promise<DataPort> {
  const db = await openDB(dbName, 1, {
    upgrade(d) {
      d.createObjectStore('drafts')
      d.createObjectStore('locks')
    },
  })

  return {
    async getDraft(ref) {
      const d = (await db.get('drafts', keyOf(ref))) as Draft | undefined
      return d ?? null
    },
    async saveDraft(input: DraftInput) {
      const k = keyOf(input)
      const existing = (await db.get('drafts', k)) as Draft | undefined
      const now = Date.now()
      const stored: Draft = {
        collection: input.collection,
        locale: input.locale,
        slug: input.slug,
        content: input.content,
        metadata: input.metadata,
        baseSha: input.baseSha ?? null,
        // Preserve the fork point across saves that omit it (editing must not move it).
        baseContent: input.baseContent !== undefined ? input.baseContent : (existing?.baseContent ?? null),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      await db.put('drafts', stored, k)
      return structuredClone(stored)
    },
    async deleteDraft(ref) {
      await db.delete('drafts', keyOf(ref))
    },
    async listDrafts(filter) {
      const all = (await db.getAll('drafts')) as Draft[]
      return filter?.collection ? all.filter((d) => d.collection === filter.collection) : all
    },
    async getLock(ref) {
      const l = (await db.get('locks', keyOf(ref))) as Lock | undefined
      return l ?? null
    },
    async putLock(lock) {
      await db.put('locks', { ...lock }, keyOf(lock))
    },
    async deleteLock(ref) {
      await db.delete('locks', keyOf(ref))
    },
    async close() {
      db.close()
    },
  }
}

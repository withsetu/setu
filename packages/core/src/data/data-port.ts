import type { Draft, DraftFilter, DraftInput, EntryRef, Lock } from './types'

/** The database port. The DB is a derived index + live store, never the source
 *  of truth for published content (§2). This first slice covers drafts + locks. */
export interface DataPort {
  getDraft(ref: EntryRef): Promise<Draft | null>
  /** Upsert. Creates on first save (createdAt = updatedAt = now); on later saves
   *  updates content/metadata/baseSha and bumps updatedAt, leaving createdAt. */
  saveDraft(input: DraftInput): Promise<Draft>
  deleteDraft(ref: EntryRef): Promise<void>
  listDrafts(filter?: DraftFilter): Promise<Draft[]>

  getLock(ref: EntryRef): Promise<Lock | null>
  /** Upsert the lock for an entry (storage only; acquire/TTL policy is core's). */
  putLock(lock: Lock): Promise<void>
  deleteLock(ref: EntryRef): Promise<void>

  /** Release adapter resources (close the DB handle). */
  close(): Promise<void>
}

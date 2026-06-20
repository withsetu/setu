import type { TiptapDoc } from '../markdoc/types'

/** Entry identity (PRD §3): one entry per (collection, locale, slug). */
export interface EntryRef {
  collection: string
  locale: string
  slug: string
}

/** A live draft — the editor's working state, stored in the DB (never Git). */
export interface Draft extends EntryRef {
  /** Live editor content as Tiptap JSON; compiles to Markdoc on publish. */
  content: TiptapDoc
  /** Field-schema metadata (title, status, author, date, custom fields). */
  metadata: Record<string, unknown>
  /** Git SHA the draft forked from (§2 base-SHA publish conflict guard). */
  baseSha: string | null
  /** The committed content this draft forked from — the PER-FILE conflict base
   *  (§2). null for an entry never committed. Editing never changes it (it is the
   *  fork reference); only fork (read service) and publish set it. */
  baseContent?: string | null
  /** Epoch ms. */
  createdAt: number
  updatedAt: number
}

/** Input to saveDraft (an upsert); timestamps are assigned by the adapter. */
export interface DraftInput extends EntryRef {
  content: TiptapDoc
  metadata: Record<string, unknown>
  /** Defaults to null when omitted. */
  baseSha?: string | null
  /** The per-file conflict base. OMIT to PRESERVE the stored value (editing must
   *  not move the fork point); set explicitly only on fork and on publish. */
  baseContent?: string | null
}

/** A pessimistic edit lock on an entry (PRD §9). TTL policy lives in core. */
export interface Lock extends EntryRef {
  lockedBy: string
  lockedAt: number
}

/** Filter for listing drafts. */
export interface DraftFilter {
  collection?: string
}

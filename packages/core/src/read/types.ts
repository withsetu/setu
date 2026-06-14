import type { Draft, EntryRef } from '../data/types'
import type { DataPort } from '../data/data-port'
import type { GitPort } from '../git/git-port'

/** Result of loading an entry for editing. */
export type LoadResult =
  /** An existing live DB draft (unpublished work-in-progress) was found. */
  | { source: 'draft'; draft: Draft }
  /** No draft existed; one was freshly materialized from published Git content. */
  | { source: 'forked'; draft: Draft }
  /** No draft and no published file — the entry does not exist. */
  | { source: 'absent' }

export interface ReadDeps {
  data: DataPort
  git: GitPort
}

export interface ReadService {
  /** Return the editable draft for `ref`: the live draft if present, else a draft
   *  forked from published Git content (persisted, baseSha = HEAD), else absent. */
  loadForEdit(ref: EntryRef): Promise<LoadResult>
}

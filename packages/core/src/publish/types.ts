import type { EntryRef } from '../data/types'
import type { DataPort } from '../data/data-port'
import type { GitAuthor } from '../git/types'
import type { GitPort } from '../git/git-port'

export interface PublishInput {
  ref: EntryRef
  /** Commit author (the editor identity). */
  author: GitAuthor
  /** Commit message; defaults to `Publish <collection>/<locale>/<slug>`. */
  message?: string
}

export interface PublishDeps {
  data: DataPort
  git: GitPort
}

/** Outcome of a publish attempt. */
export type PublishResult =
  /** Committed; `sha` is the new HEAD, `path` the committed file. */
  | { status: 'published'; sha: string; path: string }
  /** Blocked, nothing committed. Either the repo HEAD advanced since the draft
   *  forked (`baseSha` is the draft's fork point), or the draft is a new entry
   *  (`baseSha: null`) whose target file already exists in the repo. */
  | { status: 'conflict'; baseSha: string | null; headSha: string }
  /** No draft exists for `ref` — nothing to publish. */
  | { status: 'nothing' }

export interface PublishService {
  publish(input: PublishInput): Promise<PublishResult>
}

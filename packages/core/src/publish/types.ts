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
  /** Blocked: the repo advanced since the draft forked (HEAD-level guard).
   *  Nothing was committed. */
  | { status: 'conflict'; baseSha: string; headSha: string }
  /** No draft exists for `ref` — nothing to publish. */
  | { status: 'nothing' }

export interface PublishService {
  publish(input: PublishInput): Promise<PublishResult>
}

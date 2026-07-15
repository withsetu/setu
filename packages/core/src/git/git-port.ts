import type {
  CommitInput,
  CommitFilesInput,
  CommitResult,
  DiffPathEntry
} from './types'

/** The git seam: read published content + commit. Server topologies use a real
 *  local git adapter; edge uses a GitHub-API adapter (later). The DB is derived;
 *  Git is canonical for published content (§2). */
export interface GitPort {
  /** Current HEAD commit sha, or null if the repo has no commits yet. */
  headSha(): Promise<string | null>
  /** Content of `path` at HEAD, or null if it does not exist / no commits. */
  readFile(path: string): Promise<string | null>
  /** Write `path` and commit it; returns the new HEAD commit sha. */
  commitFile(input: CommitInput): Promise<CommitResult>
  /** Apply several writes/deletes in ONE atomic commit; returns the new HEAD
   *  sha. A net-empty changeset makes no commit and returns the current HEAD. */
  commitFiles(input: CommitFilesInput): Promise<CommitResult>
  /** Repo-relative paths of all files at HEAD, filtered to those under `prefix`
   *  (default: all). Empty when the repo has no commits. Order is not guaranteed. */
  list(prefix?: string): Promise<string[]>
  /** Tree-to-tree diff between two commits: every path whose content differs,
   *  with how it changed going from `fromSha`'s tree to `toSha`'s. Identical
   *  shas → empty. A sha the adapter cannot resolve (never existed, pruned) →
   *  rejects; callers treat that as "diff unavailable" and fall back to a full
   *  rescan. Order is not guaranteed. */
  diffPaths(fromSha: string, toSha: string): Promise<DiffPathEntry[]>
}

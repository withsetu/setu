import type {
  CommitInput,
  CommitFilesInput,
  CommitResult,
  DiffPathEntry,
  GitLogEntry,
  GitLogOptions
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
  /** OPTIONAL capability (#466, card #6): the revision history of `path`,
   *  newest first — only commits that touched the path. Adapters that cannot
   *  provide it (git-http/git-idb today) simply omit it; callers MUST
   *  capability-detect (`typeof git.log === 'function'`) and degrade honestly.
   *  Unknown/never-committed path → empty array. */
  log?(path: string, opts?: GitLogOptions): Promise<GitLogEntry[]>
  /** OPTIONAL capability (#466, card #6): content of `path` at commit `sha`.
   *  Path absent at that commit → null. A sha the adapter cannot resolve →
   *  rejects (parity with `diffPaths`). Omitted by adapters without history
   *  support; callers MUST capability-detect. */
  readFileAt?(sha: string, path: string): Promise<string | null>
}

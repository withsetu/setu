import type { CommitInput, CommitResult } from './types'

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
}

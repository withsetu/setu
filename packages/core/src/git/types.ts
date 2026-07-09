/** Identity stamped on a commit (the editor, not the machine's git config). */
export interface GitAuthor {
  name: string
  email: string
}

/** A single-file commit request. */
export interface CommitInput {
  /** Repo-relative path, e.g. 'content/blog/hello.mdoc'. */
  path: string
  content: string
  message: string
  /** The editor's identity (stamped on the commit, not the machine's git config). */
  author: GitAuthor
}

/** The result of a commit. */
export interface CommitResult {
  /** The new HEAD commit sha. */
  sha: string
}

/** One change in a multi-file commit: a write (create/update) or a delete. */
export type FileChange =
  | { path: string; content: string }
  | { path: string; delete: true }

/** A multi-file commit request: all changes land in ONE atomic commit. */
export interface CommitFilesInput {
  changes: FileChange[]
  message: string
  author: GitAuthor
}

/** How a path changed between two commits (tree-to-tree diff). */
export type DiffPathStatus = 'added' | 'modified' | 'deleted'

/** One changed path in a tree-to-tree diff (`GitPort.diffPaths`). */
export interface DiffPathEntry {
  /** Repo-relative path, e.g. 'content/post/en/hello.mdoc'. */
  path: string
  status: DiffPathStatus
}

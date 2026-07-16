import type {
  CommitInput,
  CommitFilesInput,
  CommitResult,
  DiffPathEntry,
  GitAuthor,
  GitLogEntry,
  GitLogOptions,
  GitPort
} from '@setu/core'

/** A pre-existing file to seed into the repo at construction. */
export interface GitSeedFile {
  path: string
  content: string
}

// Deterministic 40-char hex digest (no Date.now/Math.random): 5 salted FNV-1a
// passes. Distinct per commit because the commit counter is mixed in.
function sha40(input: string): string {
  let out = ''
  for (let salt = 0; salt < 5; salt++) {
    let h = (0x811c9dc5 ^ salt) >>> 0
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    out += h.toString(16).padStart(8, '0')
  }
  return out
}

/** In-memory GitPort (Map-backed, browser-safe). HEAD is the working set after
 *  the latest commit; `readFile` returns the current content at a path. Optional
 *  `seed` files are applied as initial commits so `headSha` is non-null and the
 *  read service can fork from them. Behaviorally equivalent to `git-local`
 *  (proven by `runGitPortContract`). */
export function createMemoryGitPort(seed: GitSeedFile[] = []): GitPort {
  const files = new Map<string, string>()
  // Commit sha → full file snapshot at that commit, so diffPaths can compare any
  // two known commits (the in-memory stand-in for a real tree-to-tree diff).
  const snapshots = new Map<string, Map<string, string>>()
  // Append-order commit metadata (oldest first) backing the optional `log`
  // capability (#466). `touched` = the paths this commit actually changed.
  const commits: Array<{
    sha: string
    author: GitAuthor
    date: string
    subject: string
    touched: Set<string>
  }> = []
  let head: string | null = null
  let counter = 0

  const SEED_AUTHOR: GitAuthor = { name: 'Seed', email: 'seed@setu.local' }

  const snapshot = (sha: string): void => {
    snapshots.set(sha, new Map(files))
  }

  // Deterministic date (no Date.now, matching sha40's rationale): one second
  // per commit from the epoch — stable ordering, parseable ISO string.
  const record = (
    sha: string,
    author: GitAuthor,
    message: string,
    touched: Set<string>
  ): void => {
    commits.push({
      sha,
      author,
      date: new Date(counter * 1000).toISOString(),
      subject: message.split('\n', 1)[0] ?? '',
      touched
    })
  }

  const apply = (path: string, content: string): string => {
    counter += 1
    files.set(path, content)
    head = sha40(`${counter}\0${head ?? ''}\0${path}\0${content}`)
    snapshot(head)
    record(head, SEED_AUTHOR, `Seed ${path}`, new Set([path]))
    return head
  }

  for (const f of seed) apply(f.path, f.content)

  const commitFiles = async ({
    changes,
    message,
    author
  }: CommitFilesInput): Promise<CommitResult> => {
    const touched = new Set<string>()
    for (const ch of changes) {
      if ('delete' in ch) {
        if (files.delete(ch.path)) touched.add(ch.path)
      } else if (files.get(ch.path) !== ch.content) {
        files.set(ch.path, ch.content)
        touched.add(ch.path)
      }
    }
    if (touched.size === 0) return { sha: head ?? '' }
    counter += 1
    head = sha40(
      `${counter}\0${head ?? ''}\0${changes.map((c) => ('delete' in c ? `D:${c.path}` : `W:${c.path}:${c.content}`)).join('\0')}`
    )
    snapshot(head)
    record(head, author, message, touched)
    return { sha: head }
  }

  const snapshotOf = (sha: string): Map<string, string> => {
    const snap = snapshots.get(sha)
    if (snap === undefined)
      throw new Error(`diffPaths: unknown commit sha: ${sha}`)
    return snap
  }

  return {
    async headSha() {
      return head
    },
    async readFile(path: string) {
      return files.has(path) ? files.get(path)! : null
    },
    commitFile(input: CommitInput): Promise<CommitResult> {
      return commitFiles({
        changes: [{ path: input.path, content: input.content }],
        message: input.message,
        author: input.author
      })
    },
    commitFiles,
    async list(prefix?: string) {
      const all = [...files.keys()]
      return prefix === undefined
        ? all
        : all.filter((p) => p.startsWith(prefix))
    },
    async diffPaths(fromSha: string, toSha: string) {
      if (fromSha === toSha) {
        snapshotOf(fromSha) // still reject an unknown sha
        return []
      }
      const from = snapshotOf(fromSha)
      const to = snapshotOf(toSha)
      const out: DiffPathEntry[] = []
      for (const [path, content] of to) {
        const before = from.get(path)
        if (before === undefined) out.push({ path, status: 'added' })
        else if (before !== content) out.push({ path, status: 'modified' })
      }
      for (const path of from.keys()) {
        if (!to.has(path)) out.push({ path, status: 'deleted' })
      }
      return out
    },
    // --- optional history capability (#466) ---
    async log(path: string, opts: GitLogOptions = {}): Promise<GitLogEntry[]> {
      const matched = commits.filter((c) => c.touched.has(path)).reverse() // append-order → newest first
      const offset = opts.offset ?? 0
      const end = opts.limit === undefined ? undefined : offset + opts.limit
      return matched
        .slice(offset, end)
        .map(({ sha, author, date, subject }) => ({
          sha,
          author: author.name,
          email: author.email,
          date,
          subject
        }))
    },
    async readFileAt(sha: string, path: string): Promise<string | null> {
      const snap = snapshots.get(sha)
      // Unknown sha rejects — parity with diffPaths (and git-local).
      if (snap === undefined)
        throw new Error(`readFileAt: unknown commit sha: ${sha}`)
      return snap.has(path) ? snap.get(path)! : null
    }
  }
}

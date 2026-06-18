import type { CommitInput, CommitResult, GitPort } from '@setu/core'

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
  let head: string | null = null
  let counter = 0

  const apply = (path: string, content: string): string => {
    counter += 1
    files.set(path, content)
    head = sha40(`${counter}\0${head ?? ''}\0${path}\0${content}`)
    return head
  }

  for (const f of seed) apply(f.path, f.content)

  return {
    async headSha() {
      return head
    },
    async readFile(path: string) {
      return files.has(path) ? files.get(path)! : null
    },
    async commitFile(input: CommitInput): Promise<CommitResult> {
      return { sha: apply(input.path, input.content) }
    },
    async list(prefix?: string) {
      const all = [...files.keys()]
      return prefix === undefined ? all : all.filter((p) => p.startsWith(prefix))
    },
  }
}

import { openDB } from 'idb'
import type { CommitInput, CommitResult, GitPort } from '@saytu/core'

// Deterministic 40-char hex digest (no Date.now/Math.random): 5 salted FNV-1a
// passes. Distinct per commit because the persisted counter is mixed in.
// (Same scheme as git-memory.)
function sha40(input: string): string {
  let out = ''
  for (let salt = 0; salt < 5; salt += 1) {
    let h = (0x811c9dc5 ^ salt) >>> 0
    for (let i = 0; i < input.length; i += 1) {
      h ^= input.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    out += h.toString(16).padStart(8, '0')
  }
  return out
}

/** An IndexedDB-backed GitPort (a `files` store path->content + a `meta` store
 *  holding the head sha and a commit counter). Behaviorally equivalent to
 *  git-memory (proven by runGitPortContract) but persistent across reloads. */
export async function createIdbGitPort(dbName = 'saytu-git'): Promise<GitPort> {
  const db = await openDB(dbName, 1, {
    upgrade(d) {
      d.createObjectStore('files')
      d.createObjectStore('meta')
    },
  })

  return {
    async headSha() {
      return ((await db.get('meta', 'head')) as string | undefined) ?? null
    },
    async readFile(path: string) {
      return ((await db.get('files', path)) as string | undefined) ?? null
    },
    async commitFile(input: CommitInput): Promise<CommitResult> {
      const counter = (((await db.get('meta', 'counter')) as number | undefined) ?? 0) + 1
      const prevHead = ((await db.get('meta', 'head')) as string | undefined) ?? ''
      const sha = sha40(`${counter}\0${prevHead}\0${input.path}\0${input.content}`)
      await db.put('files', input.content, input.path)
      await db.put('meta', counter, 'counter')
      await db.put('meta', sha, 'head')
      return { sha }
    },
    async list(prefix?: string) {
      const keys = (await db.getAllKeys('files')) as string[]
      return prefix === undefined ? keys : keys.filter((k) => k.startsWith(prefix))
    },
  }
}

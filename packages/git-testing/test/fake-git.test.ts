import { runGitPortContract } from '../src/index'
import type { DiffPathEntry, GitPort } from '@setu/core'

/** A correct in-memory GitPort — proves the contract passes a valid
 *  implementation (and would fail a broken one). */
function createFakeGit(): GitPort {
  const files = new Map<string, string>()
  const snapshots = new Map<string, Map<string, string>>()
  let head: string | null = null
  let n = 0
  const commitFiles: GitPort['commitFiles'] = async ({ changes }) => {
    let changed = false
    for (const ch of changes) {
      if ('delete' in ch) {
        if (files.delete(ch.path)) changed = true
      } else if (files.get(ch.path) !== ch.content) {
        files.set(ch.path, ch.content)
        changed = true
      }
    }
    if (!changed) return { sha: head ?? '' }
    n += 1
    head = `sha${n}`
    snapshots.set(head, new Map(files))
    return { sha: head }
  }
  const snapshotOf = (sha: string): Map<string, string> => {
    const snap = snapshots.get(sha)
    if (snap === undefined) throw new Error(`unknown commit sha: ${sha}`)
    return snap
  }
  return {
    async headSha() {
      return head
    },
    async readFile(path) {
      return files.has(path) ? files.get(path)! : null
    },
    commitFile: (i) =>
      commitFiles({
        changes: [{ path: i.path, content: i.content }],
        message: i.message,
        author: i.author
      }),
    commitFiles,
    async list(prefix) {
      const ks = [...files.keys()]
      return prefix === undefined ? ks : ks.filter((k) => k.startsWith(prefix))
    },
    async diffPaths(fromSha, toSha) {
      if (fromSha === toSha) {
        snapshotOf(fromSha)
        return []
      }
      const from = snapshotOf(fromSha)
      const to = snapshotOf(toSha)
      const out: DiffPathEntry[] = []
      for (const [path, content] of to) {
        if (!from.has(path)) out.push({ path, status: 'added' })
        else if (from.get(path) !== content)
          out.push({ path, status: 'modified' })
      }
      for (const path of from.keys())
        if (!to.has(path)) out.push({ path, status: 'deleted' })
      return out
    }
  }
}

runGitPortContract(() => createFakeGit())

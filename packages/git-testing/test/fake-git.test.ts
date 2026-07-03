import { runGitPortContract } from '../src/index'
import type { GitPort } from '@setu/core'

/** A correct in-memory GitPort — proves the contract passes a valid
 *  implementation (and would fail a broken one). */
function createFakeGit(): GitPort {
  const files = new Map<string, string>()
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
    return { sha: head }
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
    }
  }
}

runGitPortContract(() => createFakeGit())

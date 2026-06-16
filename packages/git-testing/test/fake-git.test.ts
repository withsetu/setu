import { runGitPortContract } from '../src/index'
import type { GitPort } from '@saytu/core'

/** A correct in-memory GitPort — proves the contract passes a valid
 *  implementation (and would fail a broken one). */
function createFakeGit(): GitPort {
  const files = new Map<string, string>()
  let counter = 0
  let head: string | null = null
  return {
    async headSha() {
      return head
    },
    async readFile(path) {
      return head === null ? null : files.get(path) ?? null
    },
    async commitFile({ path, content }) {
      files.set(path, content)
      head = `fakesha${++counter}`
      return { sha: head }
    },
    async list(prefix?: string) {
      const all = [...files.keys()]
      return prefix === undefined ? all : all.filter((p) => p.startsWith(prefix))
    },
  }
}

runGitPortContract(() => createFakeGit())

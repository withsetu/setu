import nodeFs from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import * as git from 'isomorphic-git'
import type { PromiseFsClient } from 'isomorphic-git'
import type { GitPort } from '@saytu/core'

export interface LocalGitOptions {
  /** Path to an existing git repository (the caller/test runs `git init`). */
  dir: string
  /** Filesystem implementation; defaults to node:fs. Any isomorphic-git
   *  PromiseFsClient (node:fs, memfs, lightning-fs) works. */
  fs?: PromiseFsClient
}

/** True when an isomorphic-git error means "not found" (unborn HEAD / absent
 *  filepath) — the expected "absent" signal we map to null. */
const isNotFound = (e: unknown): boolean =>
  e instanceof Error && (e as { code?: string }).code === 'NotFoundError'

/** A GitPort backed by a real local git repo via isomorphic-git (T1/T3). */
export function createLocalGitAdapter(options: LocalGitOptions): GitPort {
  const fs = options.fs ?? nodeFs
  const dir = options.dir

  const headSha = async (): Promise<string | null> => {
    try {
      return await git.resolveRef({ fs, dir, ref: 'HEAD' })
    } catch (e) {
      if (isNotFound(e)) return null
      throw e
    }
  }

  // Serialize commits: git's index is shared, so concurrent add→commit windows
  // would cross-contaminate. (Cross-process writers on the same dir are still the
  // caller's responsibility — single-writer per repo, per PRD §9/§16.)
  let chain: Promise<unknown> = Promise.resolve()
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn)
    chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  return {
    headSha,
    async readFile(path) {
      // Content is read from the HEAD snapshot captured at call start;
      // a concurrent commit may advance HEAD afterward (single-writer assumption).
      const oid = await headSha()
      if (oid === null) return null
      try {
        const { blob } = await git.readBlob({ fs, dir, oid, filepath: path })
        return new TextDecoder().decode(blob)
      } catch (e) {
        if (isNotFound(e)) return null
        throw e
      }
    },
    async commitFile({ path, content, message, author }) {
      return serialize(async () => {
        const repoRoot = resolve(dir)
        const full = resolve(repoRoot, path)
        if (full !== repoRoot && !full.startsWith(repoRoot + sep)) {
          throw new Error(`commitFile: path escapes the repository root: ${path}`)
        }
        await fs.promises.mkdir(dirname(full), { recursive: true })
        await fs.promises.writeFile(full, content, 'utf8')
        await git.add({ fs, dir, filepath: path })
        try {
          const sha = await git.commit({
            fs,
            dir,
            message,
            author: { name: author.name, email: author.email },
          })
          return { sha }
        } catch (e) {
          // Leave the index clean on failure so a later commit isn't polluted.
          await git.resetIndex({ fs, dir, filepath: path }).catch(() => {})
          throw e
        }
      })
    },
    async list(prefix?: string) {
      const oid = await headSha()
      if (oid === null) return []
      const all = await git.listFiles({ fs, dir, ref: 'HEAD' })
      return prefix === undefined ? all : all.filter((p) => p.startsWith(prefix))
    },
  }
}

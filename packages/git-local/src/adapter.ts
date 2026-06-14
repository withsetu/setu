import nodeFs from 'node:fs'
import { dirname, join } from 'node:path'
import * as git from 'isomorphic-git'
import type { GitPort } from '@saytu/core'

export interface LocalGitOptions {
  /** Path to an existing git repository (the caller/test runs `git init`). */
  dir: string
  /** Filesystem implementation; defaults to node:fs. */
  fs?: typeof nodeFs
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

  return {
    headSha,
    async readFile(path) {
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
      const full = join(dir, path)
      await fs.promises.mkdir(dirname(full), { recursive: true })
      await fs.promises.writeFile(full, content, 'utf8')
      await git.add({ fs, dir, filepath: path })
      const sha = await git.commit({
        fs,
        dir,
        message,
        author: { name: author.name, email: author.email },
      })
      return { sha }
    },
  }
}

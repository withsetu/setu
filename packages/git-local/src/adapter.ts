import nodeFs from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import * as git from 'isomorphic-git'
import type { PromiseFsClient } from 'isomorphic-git'
import type { GitPort, CommitFilesInput, CommitResult } from '@setu/core'

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
      () => undefined
    )
    return run
  }

  const readFileAtHead = async (path: string): Promise<string | null> => {
    const oid = await headSha()
    if (oid === null) return null
    try {
      const { blob } = await git.readBlob({ fs, dir, oid, filepath: path })
      return new TextDecoder().decode(blob)
    } catch (e) {
      if (isNotFound(e)) return null
      throw e
    }
  }

  const safePath = (p: string): string => {
    const repoRoot = resolve(dir)
    const full = resolve(repoRoot, p)
    if (full !== repoRoot && !full.startsWith(repoRoot + sep)) {
      throw new Error(`commitFiles: path escapes the repository root: ${p}`)
    }
    return full
  }

  const commitFiles = ({
    changes,
    message,
    author
  }: CommitFilesInput): Promise<CommitResult> =>
    serialize(async () => {
      const staged: string[] = []
      try {
        const pending = new Map<string, string | null>()
        const effective = async (p: string): Promise<string | null> => {
          const v = pending.get(p)
          return v === undefined ? await readFileAtHead(p) : v
        }
        for (const ch of changes) {
          const full = safePath(ch.path)
          if ('delete' in ch) {
            if ((await effective(ch.path)) !== null) {
              await fs.promises.unlink(full).catch(() => {})
              await git.remove({ fs, dir, filepath: ch.path })
              staged.push(ch.path)
            }
            pending.set(ch.path, null)
          } else {
            if ((await effective(ch.path)) !== ch.content) {
              await fs.promises.mkdir(dirname(full), { recursive: true })
              await fs.promises.writeFile(full, ch.content, 'utf8')
              await git.add({ fs, dir, filepath: ch.path })
              staged.push(ch.path)
            }
            pending.set(ch.path, ch.content)
          }
        }
        if (staged.length === 0) return { sha: (await headSha()) ?? '' }
        const sha = await git.commit({
          fs,
          dir,
          message,
          author: { name: author.name, email: author.email }
        })
        return { sha }
      } catch (e) {
        // Note: working tree may be partially written/unlinked on failure — only
        // the index is reset here, which is what matters for the next commit.
        for (const p of staged)
          await git.resetIndex({ fs, dir, filepath: p }).catch(() => {})
        throw e
      }
    })

  return {
    headSha,
    async readFile(path) {
      return readFileAtHead(path)
    },
    commitFile({ path, content, message, author }) {
      return commitFiles({ changes: [{ path, content }], message, author })
    },
    commitFiles,
    async list(prefix?: string) {
      const oid = await headSha()
      if (oid === null) return []
      const all = await git.listFiles({ fs, dir, ref: 'HEAD' })
      return prefix === undefined
        ? all
        : all.filter((p) => p.startsWith(prefix))
    }
  }
}

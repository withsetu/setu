import nodeFs from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import * as git from 'isomorphic-git'
import type { PromiseFsClient } from 'isomorphic-git'
import type {
  GitPort,
  CommitFilesInput,
  CommitResult,
  DiffPathEntry
} from '@setu/core'

/** The three direct fs.promises calls this adapter makes. isomorphic-git's
 *  PromiseFsClient types its `promises` members as bare `Function` (its API surface is
 *  fs-implementation-agnostic), which makes every call an unsafe `Function` invocation
 *  under type-aware lint. This structural view narrows just what we use — node:fs,
 *  memfs and lightning-fs all conform. */
interface FsPromisesUsed {
  unlink(path: string): Promise<unknown>
  mkdir(path: string, opts: { recursive: boolean }): Promise<unknown>
  writeFile(path: string, data: string, encoding: string): Promise<unknown>
}

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
  const fsp = fs.promises as unknown as FsPromisesUsed
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
              await fsp.unlink(full).catch(() => {})
              await git.remove({ fs, dir, filepath: ch.path })
              staged.push(ch.path)
            }
            pending.set(ch.path, null)
          } else {
            if ((await effective(ch.path)) !== ch.content) {
              await fsp.mkdir(dirname(full), { recursive: true })
              await fsp.writeFile(full, ch.content, 'utf8')
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
    },
    async diffPaths(fromSha: string, toSha: string) {
      if (fromSha === toSha) {
        // Still reject an unknown sha (parity with the other adapters).
        await git.readCommit({ fs, dir, oid: fromSha })
        return []
      }
      // Two-TREE walk — the documented isomorphic-git tree-to-tree diff pattern
      // ("Compare file states between two commits", isomorphic-git docs/snippets.md,
      // verified 2026-07-09 for isomorphic-git 1.x: git.walk with two git.TREE({ ref })
      // walkers; map receives one entry per tree, null where the path is absent).
      // An unresolvable sha makes the walk reject, which is the contract's signal.
      const results = (await git.walk({
        fs,
        dir,
        trees: [git.TREE({ ref: fromSha }), git.TREE({ ref: toSha })],
        map: async (filepath, entries) => {
          if (filepath === '.') return undefined
          const [a, b] = entries ?? [null, null]
          // Only blobs carry content; a tree (or absent) side reads as undefined,
          // so a dir→file or file→dir flip still reports the blob side correctly.
          const aOid =
            a != null && (await a.type()) === 'blob' ? await a.oid() : undefined
          const bOid =
            b != null && (await b.type()) === 'blob' ? await b.oid() : undefined
          if (aOid === bOid) return undefined // unchanged blob, tree/tree, or non-blob
          if (aOid === undefined) return { path: filepath, status: 'added' }
          if (bOid === undefined) return { path: filepath, status: 'deleted' }
          return { path: filepath, status: 'modified' }
        }
      })) as DiffPathEntry[]
      return results
    }
  }
}

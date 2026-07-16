import nodeFs from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import * as git from 'isomorphic-git'
import type { PromiseFsClient } from 'isomorphic-git'
import type {
  GitPort,
  CommitFilesInput,
  CommitResult,
  DiffPathEntry,
  GitLogEntry,
  GitLogOptions
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

  // #504: ONE cache for the adapter's lifetime, threaded through every
  // isomorphic-git call that accepts it. Without it each readBlob re-loads and
  // re-parses pack indexes/objects from scratch, making a cold content-index
  // build over N entries O(N²) (~70 s measured at 10k entries).
  //
  // Scoping decision — long-lived per adapter instance, never reset. Safe
  // because of WHAT isomorphic-git 1.38.4 actually caches (verified in the
  // installed index.js, 2026-07-15):
  //   - PackfileCache: parsed pack indexes keyed by the pack's content-addressed
  //     filename — immutable; new packs (fetch/out-of-band `git gc`) are found
  //     via a fresh readdir on every read, removed packs are simply skipped.
  //   - IndexCache: the .git/index, stat-revalidated on every acquire — an
  //     out-of-band `git add`/`commit` rewriting the index is picked up.
  //   - Refs are NOT cached (resolveRef takes no `cache` parameter), so a new
  //     HEAD — ours or an out-of-band git-CLI commit — is visible immediately.
  //     git-local.test.ts pins that freshness contract.
  const cache = {}

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

  // #504, part two: isomorphic-git's `cache` memoizes pack indexes but NOT
  // parsed loose objects or trees — and a CLI-seeded content repo is all loose
  // objects — so readBlob({ oid, filepath }) still re-reads and re-parses every
  // tree on the path for EVERY call: O(entries) per read, O(N²) per cold index
  // build (measured ~70 s at 10k entries, #465). The adapter therefore resolves
  // paths itself through a content-addressed memo: commit oid → root tree oid,
  // tree oid → parsed entries. Git object ids are immutable (same oid ⇒ same
  // bytes, forever), so memo hits can never be stale — a new commit, including
  // an out-of-band git-CLI one, has new oids and misses the memo. Freshness is
  // pinned by git-local.test.ts ("stays fresh after out-of-band commits").
  //
  // Memory bound: a cold build memoizes one tree set; long-lived servers accrue
  // a few new tree oids per commit. Past MAX_TREE_MEMO_ENTRIES total entries
  // (~20 MB worst case) the memo resets wholesale — it is only a cache.
  const MAX_TREE_MEMO_ENTRIES = 200_000
  interface TreeEntryMemo {
    oid: string
    type: string
  }
  const commitTreeMemo = new Map<string, string>()
  const treeMemo = new Map<string, Map<string, TreeEntryMemo>>()
  let treeMemoEntries = 0

  const treeEntriesOf = async (
    treeOid: string
  ): Promise<Map<string, TreeEntryMemo>> => {
    const hit = treeMemo.get(treeOid)
    if (hit !== undefined) return hit
    const { tree } = await git.readTree({ fs, dir, cache, oid: treeOid })
    const entries = new Map<string, TreeEntryMemo>(
      tree.map((e) => [e.path, { oid: e.oid, type: e.type }])
    )
    if (treeMemoEntries + entries.size > MAX_TREE_MEMO_ENTRIES) {
      treeMemo.clear()
      commitTreeMemo.clear()
      treeMemoEntries = 0
    }
    treeMemo.set(treeOid, entries)
    treeMemoEntries += entries.size
    return entries
  }

  /** Resolve `path` to a blob oid within a commit. `null` = absent (the port's
   *  "read as null" signal). `FALLBACK` = an input the fast path does not model
   *  (empty/'.'/'..' segments, directory path, path through a non-tree) —
   *  delegate to isomorphic-git's own resolver so error semantics stay
   *  identical to the pre-memo adapter (pinned in git-local.test.ts). */
  const FALLBACK = Symbol('fallback')
  const resolveBlobOid = async (
    commitOid: string,
    path: string
  ): Promise<string | null | typeof FALLBACK> => {
    const segments = path.split('/')
    if (segments.some((s) => s === '' || s === '.' || s === '..'))
      return FALLBACK
    let treeOid = commitTreeMemo.get(commitOid)
    if (treeOid === undefined) {
      treeOid = (await git.readCommit({ fs, dir, cache, oid: commitOid }))
        .commit.tree
      commitTreeMemo.set(commitOid, treeOid)
    }
    const leafName = segments[segments.length - 1]
    if (leafName === undefined) return FALLBACK // unreachable: split() yields ≥1
    for (const seg of segments.slice(0, -1)) {
      const entry = (await treeEntriesOf(treeOid)).get(seg)
      if (entry === undefined) return null
      if (entry.type !== 'tree') return FALLBACK
      treeOid = entry.oid
    }
    const leaf = (await treeEntriesOf(treeOid)).get(leafName)
    if (leaf === undefined) return null
    if (leaf.type !== 'blob') return FALLBACK
    return leaf.oid
  }

  const readFileAtCommit = async (
    commitOid: string,
    path: string
  ): Promise<string | null> => {
    try {
      const resolved = await resolveBlobOid(commitOid, path)
      if (resolved === null) return null
      const { blob } =
        resolved === FALLBACK
          ? await git.readBlob({
              fs,
              dir,
              cache,
              oid: commitOid,
              filepath: path
            })
          : await git.readBlob({ fs, dir, cache, oid: resolved })
      return new TextDecoder().decode(blob)
    } catch (e) {
      if (isNotFound(e)) return null
      throw e
    }
  }

  const readFileAtHead = async (path: string): Promise<string | null> => {
    const oid = await headSha()
    if (oid === null) return null
    return readFileAtCommit(oid, path)
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
              await git.remove({ fs, dir, cache, filepath: ch.path })
              staged.push(ch.path)
            }
            pending.set(ch.path, null)
          } else {
            if ((await effective(ch.path)) !== ch.content) {
              await fsp.mkdir(dirname(full), { recursive: true })
              await fsp.writeFile(full, ch.content, 'utf8')
              await git.add({ fs, dir, cache, filepath: ch.path })
              staged.push(ch.path)
            }
            pending.set(ch.path, ch.content)
          }
        }
        if (staged.length === 0) return { sha: (await headSha()) ?? '' }
        const sha = await git.commit({
          fs,
          dir,
          cache,
          message,
          author: { name: author.name, email: author.email }
        })
        return { sha }
      } catch (e) {
        // Note: working tree may be partially written/unlinked on failure — only
        // the index is reset here, which is what matters for the next commit.
        for (const p of staged)
          await git.resetIndex({ fs, dir, cache, filepath: p }).catch(() => {})
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
      const all = await git.listFiles({ fs, dir, cache, ref: 'HEAD' })
      return prefix === undefined
        ? all
        : all.filter((p) => p.startsWith(prefix))
    },
    async diffPaths(fromSha: string, toSha: string) {
      if (fromSha === toSha) {
        // Still reject an unknown sha (parity with the other adapters).
        await git.readCommit({ fs, dir, cache, oid: fromSha })
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
        cache,
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
    },
    // --- optional history capability (#466) ---
    async log(path: string, opts: GitLogOptions = {}): Promise<GitLogEntry[]> {
      let commits
      try {
        // `filepath` restricts the walk to commits where the path's blob
        // changed; `force: true` makes an unknown path resolve to [] instead of
        // throwing (isomorphic-git 1.38.4 log jsdoc, verified in the installed
        // index.d.ts 2026-07-15). `depth` is NOT used: it bounds walked
        // commits, not matched ones, so paging slices the matched list instead
        // (admin-volume reads — a content file's history is small).
        commits = await git.log({
          fs,
          dir,
          cache,
          ref: 'HEAD',
          filepath: path,
          force: true
        })
      } catch (e) {
        if (isNotFound(e)) return [] // unborn HEAD (empty repo)
        throw e
      }
      const offset = opts.offset ?? 0
      const end = opts.limit === undefined ? undefined : offset + opts.limit
      return commits.slice(offset, end).map(({ oid, commit }) => ({
        sha: oid,
        author: commit.author.name,
        email: commit.author.email,
        date: new Date(commit.author.timestamp * 1000).toISOString(),
        subject: commit.message.split('\n', 1)[0] ?? ''
      }))
    },
    async readFileAt(sha: string, path: string): Promise<string | null> {
      // Resolve the commit FIRST so an unknown sha rejects (diffPaths parity) —
      // the resolver's own NotFoundError for "absent path" maps to null instead.
      // (The memo makes the extra readCommit cheap on repeat reads: same oid ⇒
      // commitTreeMemo hit inside readFileAtCommit.)
      await git.readCommit({ fs, dir, cache, oid: sha })
      return readFileAtCommit(sha, path)
    }
  }
}

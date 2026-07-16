/** Real DemoEngine wiring (#513) — everything effectful behind demo.ts's
 *  engine seam. Loaded LAZILY by server.ts (dynamic import inside the engine
 *  thunk) and only when the demo routes are enabled, so a production
 *  self-hosted api never pulls @setu/demo-data's module graph.
 *
 *  Reset levels (semantics the panel's confirm dialogs state verbatim):
 *  - 'generated'  — removeSeeded: ONLY what seeding created (manifest-driven).
 *    Hand-made content, hand-uploaded media, real accounts: untouched.
 *  - 'sample'     — removeSeeded, then one commit that restores `content/` to
 *    the shipped samples and clears `taxonomy/`. Your account, settings.json,
 *    and hand-uploaded media survive; hand-made content does not (that is what
 *    "reset to sample" means — scripts/content-sandbox.mjs semantics, but
 *    in-process: the api holds the sandbox's git repo AND its sqlite files
 *    open, so `rm -rf` + re-seed from outside would yank state out from under
 *    live handles. Committing the restore through the shared GitPort keeps
 *    one writer and an honest history).
 *  - 'zero'       — removeSeeded, then one commit deleting ALL of `content/`
 *    and `taxonomy/`. Empty site; owner account, settings.json and
 *    hand-uploaded media survive.
 *
 *  Every commit goes through the SAME GitPort instance the api's routes use
 *  (git-local serializes per process — a second adapter would reintroduce the
 *  cross-writer hazard the engine warns about), which is also why
 *  `probeApiLive` is pinned false: the "a dev api is running" warning targets
 *  CROSS-process seeding; here the api itself is the seeder. */
import { readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import type { GitPort, ImagePort, StoragePort } from '@setu/core'
import {
  createAicPack,
  detectAicSource,
  fetchAicDump,
  removeSeeded,
  resolveRepoRoot,
  seedDemoData,
  DEMO_DATA_AUTHOR
} from '@setu/demo-data'
import { createSqliteUserStore } from '@setu/demo-data/user-store'
import type {
  DemoDatasetStatus,
  DemoEngine,
  DemoResetSummary,
  DemoRunContext
} from './demo'

export interface DemoWiringOptions {
  /** The content sandbox the api serves (SETU_REPO_DIR). */
  sandboxDir: string
  /** Media storage root (SETU_MEDIA_DIR). */
  mediaDir: string
  /** The api's auth/submissions sqlite file — demo users are created in the
   *  SAME DB the running api verifies logins against. */
  submissionsDb: string
  /** The api's shared GitPort — one writer per process. */
  git: GitPort
  storage: StoragePort
  image: ImagePort
  /** Canonical samples root (`<repo>/content`) for the 'sample' level. */
  sampleContentDir?: string
  /** Where the AIC dump lives / gets downloaded (`<repo>/.demo-data`). */
  demoDataDir?: string
  /** Root used for dataset auto-detection. */
  repoRoot?: string
}

/** Repo-relative paths (posix) of every file under `<root>/<top>/…`. */
async function walkFiles(root: string, top: string): Promise<string[]> {
  const abs = path.join(root, top)
  let entries: Dirent[]
  try {
    entries = await readdir(abs, { recursive: true, withFileTypes: true })
  } catch {
    return [] // the tree doesn't exist — nothing to list
  }
  const files: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const rel = path
      .relative(root, path.join(entry.parentPath, entry.name))
      .split(path.sep)
      .join('/')
    files.push(rel)
  }
  return files.sort()
}

export function buildDemoEngine(opts: DemoWiringOptions): DemoEngine {
  const repoRoot = opts.repoRoot ?? resolveRepoRoot()
  const sampleContentDir =
    opts.sampleContentDir ?? path.join(repoRoot, 'content')
  const demoDataDir = opts.demoDataDir ?? path.join(repoRoot, '.demo-data')
  const users = createSqliteUserStore(opts.submissionsDb)
  const sharedDeps = {
    git: opts.git,
    storage: opts.storage,
    image: opts.image,
    users,
    // In-process seeding: the api IS the single writer — the engine's
    // "stop pnpm dev" cross-process warning does not apply to itself.
    probeApiLive: async () => false
  }

  const datasetStatus = async (): Promise<DemoDatasetStatus> => {
    const source = await detectAicSource(repoRoot)
    if (source === null) return { present: false, kind: null }
    return {
      present: true,
      kind: source.endsWith('.jsonl') ? 'sample' : 'dump'
    }
  }

  /** The wipe(+restore) commit shared by 'sample' and 'zero'. */
  const resetContent = async (
    level: 'sample' | 'zero',
    ctx: DemoRunContext
  ): Promise<DemoResetSummary> => {
    // 1 — manifest-driven removal first: demo users + seeded media only exist
    // in the manifest; the wholesale content wipe below can't reach them.
    const removed = await removeSeeded({
      sandboxDir: opts.sandboxDir,
      mediaDir: opts.mediaDir,
      onProgress: ctx.onProgress,
      signal: ctx.signal,
      deps: sharedDeps
    })
    ctx.signal.throwIfAborted()

    // 2 — one atomic commit: delete everything under content/ + taxonomy/,
    // restoring the shipped samples for the 'sample' level.
    const existing = [
      ...(await walkFiles(opts.sandboxDir, 'content')),
      ...(await walkFiles(opts.sandboxDir, 'taxonomy'))
    ]
    const restores = new Map<string, string>()
    if (level === 'sample') {
      for (const rel of await walkFiles(
        path.dirname(sampleContentDir),
        path.basename(sampleContentDir)
      )) {
        // rel is relative to the samples PARENT, i.e. already `content/…`.
        restores.set(
          rel,
          await readFile(path.join(path.dirname(sampleContentDir), rel), 'utf8')
        )
      }
    }
    const changes = [
      ...existing
        .filter((p) => !restores.has(p))
        .map((p) => ({ path: p, delete: true as const })),
      ...[...restores.entries()].map(([p, content]) => ({ path: p, content }))
    ]
    if (changes.length > 0) {
      await opts.git.commitFiles({
        changes,
        message:
          level === 'sample'
            ? 'demo-data: reset to sample content'
            : 'demo-data: erase all content (absolute zero)',
        author: DEMO_DATA_AUTHOR
      })
    }
    return {
      removed,
      filesRemoved: existing.length,
      filesRestored: restores.size
    }
  }

  return {
    datasetStatus,

    async seed(request) {
      const source = await detectAicSource(repoRoot)
      if (source === null)
        throw new Error(
          'No demo dataset found — download it from the Dataset section first.'
        )
      const pack = createAicPack({
        source,
        ...(request.relaxText ? { textTier: 'relaxed' as const } : {})
      })
      return seedDemoData({
        sandboxDir: opts.sandboxDir,
        mediaDir: opts.mediaDir,
        pack,
        posts: request.posts,
        users: request.users,
        draftFraction: request.draftFraction,
        relaxText: request.relaxText,
        ...(request.limitImages !== undefined
          ? { limitImages: request.limitImages }
          : {}),
        onProgress: request.onProgress,
        signal: request.signal,
        deps: sharedDeps
      })
    },

    removeGenerated(ctx: DemoRunContext) {
      return removeSeeded({
        sandboxDir: opts.sandboxDir,
        mediaDir: opts.mediaDir,
        onProgress: ctx.onProgress,
        signal: ctx.signal,
        deps: sharedDeps
      })
    },

    resetSample: (ctx) => resetContent('sample', ctx),
    resetZero: (ctx) => resetContent('zero', ctx),

    async fetchDump({ onProgress }) {
      // Two passes over the same helper: the download phase (extract:false)
      // reuses an existing tarball, then extraction runs on it — so the panel
      // gets an honest phase label for each long step.
      onProgress('download')
      await fetchAicDump(demoDataDir, { extract: false })
      onProgress('extract')
      await fetchAicDump(demoDataDir, { extract: true })
    }
  }
}

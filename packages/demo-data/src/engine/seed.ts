/** `seedDemoData` (#512) — the demo-data seed engine. Phases, in order:
 *
 *  1. users (idempotent; passwords surfaced once in the summary)
 *  2. plan (one deterministic pack stream → slugs/owners/drafts/cids/keys)
 *  3. categories (ONE batch commit merging taxonomy/categories.yaml)
 *  4. images (resumable bounded-concurrency batch; failures counted not fatal)
 *  5. posts (chunked `commitFiles`, ~200/commit, committed AS the owning user)
 *
 *  Images run before posts so `featuredImage` is only written for media that
 *  actually exists — a failed download yields a post without a featured image,
 *  never a dangling reference. Resume: the checkpoint (same runKey) skips
 *  completed images/chunks; the manifest gives cross-run slug/media reuse, so
 *  re-running is idempotent (recommits are net-empty no-ops).
 *
 *  Single-writer warning: git-local serializes commits IN-PROCESS only —
 *  cross-process writers on one repo are unsafe by contract (see
 *  packages/git-local/src/adapter.ts). The engine probes the dev api port and
 *  warns; stop `pnpm dev` (or point the engine at another sandbox) for big
 *  seeds. Saved ≠ live (card #7): seeding commits content; a static site
 *  still needs its own rebuild to show it. */
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  TAXONOMY_PATH,
  contentPath,
  parseCategories,
  serializeCategories,
  serializeMdoc
} from '@setu/core'
import type { FileChange, GitAuthor, GitPort } from '@setu/core'
import { buildPostFrontmatter } from './frontmatter'
import { mediaAlreadyIngested, runImageBatch } from './images'
import type { ImageTask } from './images'
import { demoUserSpecs } from './partition'
import { buildPlan } from './plan'
import type { PostPlan } from './plan'
import { probeLocalPort } from './probe'
import {
  loadCheckpoint,
  loadManifest,
  mergeManifest,
  runKeyOf,
  saveCheckpoint,
  saveManifest
} from './state'
import type { SeedCheckpoint, SeedManifest } from './state'
import { ensureUsers } from './users'
import type { SeedDeps, SeedOptions, SeedSummary, UserStore } from './types'

export const POSTS_PER_COMMIT = 200
/** Neutral identity for commits not owned by a demo user (categories, removal). */
export const DEMO_DATA_AUTHOR: GitAuthor = {
  name: 'Setu Demo Data',
  email: 'demo-data@setu.local'
}

interface ResolvedDeps {
  git: GitPort
  storage: NonNullable<SeedDeps['storage']>
  image: NonNullable<SeedDeps['image']>
  users: UserStore
  fetch: NonNullable<SeedDeps['fetch']>
  probeApiLive: () => Promise<boolean>
  now: () => number
}

/** Fill in the real local adapters for anything not injected. Heavy defaults
 *  (sharp, sqlite/better-auth, isomorphic-git) load lazily so tests that
 *  inject fakes never touch them. */
export async function resolveDeps(
  sandboxDir: string,
  mediaDir: string,
  deps: SeedDeps = {}
): Promise<ResolvedDeps> {
  let git = deps.git
  if (!git) {
    const { createLocalGitAdapter } = await import('@setu/git-local')
    git = createLocalGitAdapter({ dir: sandboxDir })
  }
  let storage = deps.storage
  if (!storage) {
    const { createLocalStorage } = await import('@setu/storage-local')
    storage = createLocalStorage({ dir: mediaDir, baseUrl: '/media' })
  }
  let image = deps.image
  if (!image) {
    const { createSharpImageAdapter } = await import('@setu/image-sharp')
    image = createSharpImageAdapter()
  }
  let users = deps.users
  if (!users) {
    const { createSqliteUserStore, submissionsDbFile } =
      await import('./user-store')
    users = createSqliteUserStore(submissionsDbFile(sandboxDir))
  }
  let fetchOpts = deps.fetch
  if (!fetchOpts) {
    const { nodeResolveHost } = await import('../aic/fetch-dump')
    fetchOpts = { resolveHost: nodeResolveHost }
  }
  return {
    git,
    storage,
    image,
    users,
    fetch: fetchOpts,
    probeApiLive:
      deps.probeApiLive ??
      (() =>
        probeLocalPort(Number(process.env['SETU_API_PORT'] ?? '4444') || 4444)),
    now: deps.now ?? Date.now
  }
}

/** Deterministic chunking, grouped by owner so each commit carries ONE
 *  author identity: `<ownerEmail>#<n>` → up to POSTS_PER_COMMIT plans. */
export function chunkByOwner(
  plans: PostPlan[],
  perCommit = POSTS_PER_COMMIT
): Array<{ key: string; owner: PostPlan['owner']; plans: PostPlan[] }> {
  const byOwner = new Map<string, PostPlan[]>()
  for (const plan of plans) {
    const list = byOwner.get(plan.owner.email)
    if (list) list.push(plan)
    else byOwner.set(plan.owner.email, [plan])
  }
  const chunks: Array<{
    key: string
    owner: PostPlan['owner']
    plans: PostPlan[]
  }> = []
  for (const [email, list] of byOwner) {
    for (let i = 0; i < list.length; i += perCommit) {
      chunks.push({
        key: `${email}#${i / perCommit}`,
        owner: list[0]!.owner,
        plans: list.slice(i, i + perCommit)
      })
    }
  }
  return chunks
}

export async function seedDemoData(options: SeedOptions): Promise<SeedSummary> {
  const started = Date.now()
  const {
    sandboxDir,
    mediaDir,
    pack,
    posts: postCount,
    collection = 'post',
    locale = 'en',
    draftFraction = 0.1,
    imageWidthMix = [400, 843, 843, 1686],
    limitImages,
    relaxText = false,
    concurrency = 4,
    onProgress,
    signal
  } = options

  if (!Number.isInteger(postCount) || postCount < 0)
    throw new Error(`Invalid post count: ${postCount}`)
  if (draftFraction < 0 || draftFraction > 1)
    throw new Error(`draftFraction must be within 0..1, got ${draftFraction}`)
  if (imageWidthMix.length === 0)
    throw new Error('imageWidthMix must not be empty')
  // The engine only ever targets a dev sandbox — an existing git repo. It
  // refuses to invent one: a wrong path must fail loudly, not silently seed
  // into a fresh repo nobody serves.
  if (!existsSync(path.join(sandboxDir, '.git')))
    throw new Error(
      `${sandboxDir} is not a git repository — seed a dev sandbox first ` +
        '(node scripts/content-sandbox.mjs seed <name>)'
    )

  const userSpecs = demoUserSpecs(options.users)
  if (userSpecs.length === 0)
    throw new Error('Seeding needs at least one demo user (users: {...})')

  const deps = await resolveDeps(sandboxDir, mediaDir, options.deps)

  if (await deps.probeApiLive()) {
    onProgress?.({
      phase: 'warning',
      message:
        'A dev api appears to be running. git-local is single-writer PER ' +
        'PROCESS — concurrent commits from the api against the same sandbox ' +
        'can corrupt the repo. Stop `pnpm dev` during large seeds.'
    })
  }

  // -- 1 · users ------------------------------------------------------------
  const userSummaries = await ensureUsers(
    deps.users,
    userSpecs,
    (done, total) => onProgress?.({ phase: 'users', done, total })
  )
  let manifest: SeedManifest = mergeManifest(await loadManifest(sandboxDir), {
    users: userSpecs.map((u) => ({ email: u.email, role: u.role }))
  })
  await saveManifest(sandboxDir, manifest)

  // -- 2 · plan ---------------------------------------------------------------
  const runKey = runKeyOf({
    packId: pack.meta.id,
    sourceFingerprint: pack.meta.sourceFingerprint ?? '',
    posts: postCount,
    users: Object.fromEntries(
      Object.entries(options.users).map(([k, v]) => [k, v ?? 0])
    ),
    collection,
    locale,
    draftFraction,
    imageWidthMix,
    limitImages: limitImages ?? null,
    relaxText
  })
  const checkpoint: SeedCheckpoint = await loadCheckpoint(sandboxDir, runKey)

  const existingCategoriesRaw = await deps.git.readFile(TAXONOMY_PATH)
  const buildOpts: Parameters<typeof buildPlan>[0] = {
    pack,
    git: deps.git,
    storage: deps.storage,
    manifest,
    users: userSpecs,
    posts: postCount,
    collection,
    locale,
    draftFraction,
    imageWidthMix,
    existingCategories: parseCategories(existingCategoriesRaw ?? ''),
    priorImageKeys: new Map(
      Object.entries(checkpoint.images).map(([id, v]) => [id, v.mediaKey])
    ),
    onProgress: (done, total) => onProgress?.({ phase: 'plan', done, total })
  }
  if (limitImages !== undefined) buildOpts.limitImages = limitImages
  if (signal) buildOpts.signal = signal
  const plan = await buildPlan(buildOpts)

  // Crash-safety invariant: the MANIFEST records intent BEFORE any side
  // effect (so everything this run may create is removable and slug/key
  // memory survives a hard kill); the CHECKPOINT records completion AFTER
  // (so a crash can only cause idempotent redone work, never skipped work).
  // Recording the whole plan up front is one write and makes every later
  // phase side-effect-first-crash-safe: a re-run re-derives the same plan
  // from the manifest memory, and unseed skips entries that never landed.
  manifest = mergeManifest(manifest, {
    posts: plan.posts.map((p) => ({
      collection,
      locale,
      slug: p.slug,
      packId: p.id
    })),
    mediaKeys: plan.posts
      .filter((p) => p.image !== undefined)
      .map((p) => p.image!.mediaKey),
    categories: plan.addedCategorySlugs
  })
  await saveManifest(sandboxDir, manifest)

  let commits = 0
  const commit = async (
    changes: FileChange[],
    message: string,
    author: GitAuthor
  ): Promise<void> => {
    const before = await deps.git.headSha()
    const { sha } = await deps.git.commitFiles({ changes, message, author })
    if (sha !== before) commits++
  }

  // -- 3 · categories (one commit; intent already in the manifest) ------------
  if (plan.addedCategorySlugs.length > 0 && !checkpoint.categoriesDone) {
    await commit(
      [
        {
          path: TAXONOMY_PATH,
          content: serializeCategories(plan.categories)
        }
      ],
      `demo-data: register ${plan.addedCategorySlugs.length} categories (${pack.meta.id})`,
      DEMO_DATA_AUTHOR
    )
  }
  checkpoint.categoriesDone = true
  await saveCheckpoint(sandboxDir, checkpoint)
  onProgress?.({ phase: 'categories', added: plan.addedCategorySlugs.length })

  // -- 4 · images (resumable batch) -------------------------------------------
  const imageTasks: ImageTask[] = plan.posts
    .filter((p) => p.image !== undefined)
    .map((p) => ({
      id: p.id,
      url: p.image!.url,
      mediaKey: p.image!.mediaKey,
      filename: `${p.slug}.jpg`
    }))

  // Cross-run reuse: every planned key is already in the manifest (intent
  // snapshot), and the plan's collision ladder treats manifest keys as ours —
  // so "the storage-side ingest finished" alone proves reuse, even when the
  // checkpoint was lost to a crash or the runKey changed.
  const reusable = new Set<string>()
  for (const task of imageTasks) {
    if (
      checkpoint.images[task.id]?.status === 'done' &&
      checkpoint.images[task.id]?.mediaKey === task.mediaKey
    ) {
      reusable.add(task.id)
    } else if (await mediaAlreadyIngested(deps.storage, task.mediaKey)) {
      reusable.add(task.id)
    }
  }

  // Serialize checkpoint writes from concurrent workers, and throttle —
  // rewriting the file on every one of 30k results would be quadratic I/O.
  // Losing up to a throttle-window of entries to a crash is safe: the
  // checkpoint is a completion CACHE (re-run re-verifies via
  // mediaAlreadyIngested); the manifest already holds every planned key.
  let stateChain: Promise<void> = Promise.resolve()
  let pendingFlush = 0
  const queueState = (fn: () => Promise<void>): Promise<void> => {
    stateChain = stateChain.then(fn, fn)
    return stateChain
  }
  const flushState = (force: boolean): Promise<void> =>
    queueState(async () => {
      pendingFlush++
      if (!force && pendingFlush % 25 !== 0) return
      await saveCheckpoint(sandboxDir, checkpoint)
    })

  let imagesDone = 0
  let imagesFailed = 0
  let imagesReused = 0
  /** Ids whose image was freshly downloaded THIS run — a post already
   *  committed by a previous run (image failed then) needs its chunk
   *  re-committed so `featuredImage` lands. */
  const freshlyIngested = new Set<string>()
  const totalImages = imageTasks.length
  let batchError: Error | undefined
  try {
    await runImageBatch({
      tasks: imageTasks,
      storage: deps.storage,
      image: deps.image,
      fetchOpts: deps.fetch,
      concurrency,
      ...(signal ? { signal } : {}),
      isDone: (task) => reusable.has(task.id),
      onResult: async (task, result) => {
        if (result === 'reused') imagesReused++
        else if (result === 'done') {
          imagesDone++
          freshlyIngested.add(task.id)
        } else imagesFailed++
        checkpoint.images[task.id] = {
          mediaKey: task.mediaKey,
          status: result === 'failed' ? 'failed' : 'done'
        }
        onProgress?.({
          phase: 'images',
          done: imagesDone + imagesReused,
          failed: imagesFailed,
          total: totalImages
        })
        await flushState(false)
      },
      now: deps.now
    })
  } catch (err) {
    batchError =
      err instanceof Error
        ? err
        : new Error(typeof err === 'string' ? err : 'image batch aborted')
  }
  await flushState(true) // always land the final state, aborted or not
  if (batchError !== undefined) throw batchError

  // -- 5 · posts (chunked commits as the owning user) --------------------------
  const ingested = (p: PostPlan): boolean =>
    p.image !== undefined && checkpoint.images[p.id]?.status === 'done'

  // A retry that succeeded AFTER a chunk was committed must re-open that
  // chunk so the post picks up its featuredImage.
  const chunks = chunkByOwner(plan.posts)
  const doneChunks = new Set(checkpoint.chunksDone)

  let postsCommitted = 0
  for (const chunk of chunks) {
    signal?.throwIfAborted()
    if (doneChunks.has(chunk.key)) {
      const stale = chunk.plans.some((p) => freshlyIngested.has(p.id))
      // Normal case: chunk already landed and nothing changed — skip.
      if (!stale) {
        postsCommitted += chunk.plans.length
        onProgress?.({
          phase: 'posts',
          done: postsCommitted,
          total: plan.posts.length
        })
        continue
      }
    }
    const changes: FileChange[] = chunk.plans.map((p) => ({
      path: contentPath({ collection, locale, slug: p.slug }),
      content: serializeMdoc({
        frontmatter: buildPostFrontmatter({
          cid: p.cid,
          title: p.title,
          date: p.date,
          draft: p.draft,
          categories: p.categories,
          tags: p.tags,
          ...(ingested(p) && p.image
            ? { featuredImage: p.image.featuredImage }
            : {}),
          authorEmail: chunk.owner.email
        }),
        body: p.body.endsWith('\n') ? p.body : `${p.body}\n`
      })
    }))
    await commit(
      changes,
      `demo-data: seed ${chunk.plans.length} entries in ${collection} (${pack.meta.id})`,
      { name: chunk.owner.name, email: chunk.owner.email }
    )
    postsCommitted += chunk.plans.length
    // Completion AFTER the commit (crash between = an idempotent re-commit
    // next run, never a skipped chunk); the manifest already knows the posts.
    checkpoint.chunksDone = [...new Set([...checkpoint.chunksDone, chunk.key])]
    await saveCheckpoint(sandboxDir, checkpoint)
    onProgress?.({
      phase: 'posts',
      done: postsCommitted,
      total: plan.posts.length
    })
  }

  return {
    users: userSummaries,
    posts: plan.posts.length,
    images: imagesDone,
    imagesReused,
    imageFailures: imagesFailed,
    commits,
    skipped: plan.skipped,
    durationMs: Date.now() - started
  }
}

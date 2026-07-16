/** On-disk seed state under `<sandbox>/.setu/` (#512):
 *
 *  - **checkpoint** (`demo-seed-checkpoint.json`) — per-run resume state. A
 *    run is identified by a `runKey` (hash of the options that shape the
 *    plan); a checkpoint from a different runKey is discarded, one from the
 *    same runKey lets a re-run skip completed images and post chunks instead
 *    of redoing work. Deliberately does NOT persist bodies/plans: the plan is
 *    re-derived deterministically (deterministic pack stream + the manifest's
 *    packId→slug memory), so the checkpoint stays small and unforgeable-cheap.
 *
 *  - **manifest** (`demo-seed-manifest.json`) — the durable record of
 *    everything seeding ever generated (slugs per collection/locale, media
 *    keys, users, added category slugs). Append-safe across runs; #513's
 *    "remove generated only" reset consumes it. Both files are tolerant
 *    readers: missing/corrupt → empty state, never a crash. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

export const CHECKPOINT_FILE = 'demo-seed-checkpoint.json'
export const MANIFEST_FILE = 'demo-seed-manifest.json'

const setuDir = (sandboxDir: string): string => path.join(sandboxDir, '.setu')

// ---------- checkpoint ----------

export type SeedImageStatus = 'done' | 'failed'

export interface SeedCheckpoint {
  version: 1
  runKey: string
  categoriesDone: boolean
  /** Pack post id → image outcome (`done` items are skipped on re-run,
   *  `failed` items are retried) with the media key that was used. */
  images: Record<string, { mediaKey: string; status: SeedImageStatus }>
  /** Chunk keys (`<ownerEmail>#<n>`) whose commit already landed. */
  chunksDone: string[]
}

/** Stable identity for a seed run: the options that shape the plan. Same
 *  options → same key → the checkpoint is resumable. */
export function runKeyOf(identity: {
  packId: string
  posts: number
  users: Record<string, number>
  collection: string
  locale: string
  draftFraction: number
  imageWidthMix: readonly number[]
  limitImages: number | null
  relaxText: boolean
}): string {
  // JSON of an explicitly-ordered array — key order can never wobble the hash.
  const canonical = JSON.stringify([
    identity.packId,
    identity.posts,
    Object.keys(identity.users)
      .sort()
      .map((k) => [k, identity.users[k]]),
    identity.collection,
    identity.locale,
    identity.draftFraction,
    [...identity.imageWidthMix],
    identity.limitImages,
    identity.relaxText
  ])
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

export function emptyCheckpoint(runKey: string): SeedCheckpoint {
  return {
    version: 1,
    runKey,
    categoriesDone: false,
    images: {},
    chunksDone: []
  }
}

/** Load the checkpoint for `runKey`; a missing/corrupt/foreign-run file yields
 *  a fresh empty checkpoint (resume only ever skips work it can prove). */
export async function loadCheckpoint(
  sandboxDir: string,
  runKey: string
): Promise<SeedCheckpoint> {
  const file = path.join(setuDir(sandboxDir), CHECKPOINT_FILE)
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as SeedCheckpoint).version === 1 &&
      (parsed as SeedCheckpoint).runKey === runKey &&
      typeof (parsed as SeedCheckpoint).images === 'object' &&
      Array.isArray((parsed as SeedCheckpoint).chunksDone)
    ) {
      return parsed as SeedCheckpoint
    }
  } catch {
    /* missing or corrupt → fresh */
  }
  return emptyCheckpoint(runKey)
}

export async function saveCheckpoint(
  sandboxDir: string,
  checkpoint: SeedCheckpoint
): Promise<void> {
  const dir = setuDir(sandboxDir)
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, CHECKPOINT_FILE),
    JSON.stringify(checkpoint, null, 2),
    'utf8'
  )
}

export async function clearCheckpoint(sandboxDir: string): Promise<void> {
  await rm(path.join(setuDir(sandboxDir), CHECKPOINT_FILE), { force: true })
}

// ---------- manifest ----------

export interface ManifestPost {
  collection: string
  locale: string
  slug: string
  /** The pack's stable post id — lets a later, larger seed of the same pack
   *  recognize an already-seeded post and reuse its slug (idempotent re-seed)
   *  instead of minting a duplicate. */
  packId: string
}

export interface SeedManifest {
  version: 1
  posts: ManifestPost[]
  mediaKeys: string[]
  users: Array<{ email: string; role: string }>
  /** Category slugs ADDED by seeding (pre-existing categories are never
   *  touched by removal). */
  categories: string[]
}

export function emptyManifest(): SeedManifest {
  return { version: 1, posts: [], mediaKeys: [], users: [], categories: [] }
}

export async function loadManifest(sandboxDir: string): Promise<SeedManifest> {
  const file = path.join(setuDir(sandboxDir), MANIFEST_FILE)
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as SeedManifest).version === 1 &&
      Array.isArray((parsed as SeedManifest).posts) &&
      Array.isArray((parsed as SeedManifest).mediaKeys) &&
      Array.isArray((parsed as SeedManifest).users) &&
      Array.isArray((parsed as SeedManifest).categories)
    ) {
      return parsed as SeedManifest
    }
  } catch {
    /* missing or corrupt → empty */
  }
  return emptyManifest()
}

/** Merge additions into a manifest, deduplicating every list (posts by
 *  collection/locale/slug, users by email). Pure — append-safe across runs. */
export function mergeManifest(
  base: SeedManifest,
  add: Partial<Omit<SeedManifest, 'version'>>
): SeedManifest {
  const posts = [...base.posts]
  const postKeys = new Set(
    posts.map((p) => `${p.collection}/${p.locale}/${p.slug}`)
  )
  for (const p of add.posts ?? []) {
    const key = `${p.collection}/${p.locale}/${p.slug}`
    if (!postKeys.has(key)) {
      postKeys.add(key)
      posts.push(p)
    }
  }
  const users = [...base.users]
  const userKeys = new Set(users.map((u) => u.email))
  for (const u of add.users ?? []) {
    if (!userKeys.has(u.email)) {
      userKeys.add(u.email)
      users.push(u)
    }
  }
  return {
    version: 1,
    posts,
    mediaKeys: [...new Set([...base.mediaKeys, ...(add.mediaKeys ?? [])])],
    users,
    categories: [...new Set([...base.categories, ...(add.categories ?? [])])]
  }
}

export async function saveManifest(
  sandboxDir: string,
  manifest: SeedManifest
): Promise<void> {
  const dir = setuDir(sandboxDir)
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2),
    'utf8'
  )
}

export async function clearManifest(sandboxDir: string): Promise<void> {
  await rm(path.join(setuDir(sandboxDir), MANIFEST_FILE), { force: true })
}

/** `removeSeeded` (#512) — the "remove generated only" primitive #513's reset
 *  levels consume. Consumes the seed manifest and removes ONLY what seeding
 *  generated:
 *
 *  - seeded posts: chunked batch delete commits (hand-made content untouched)
 *  - seeded media: original + variants + manifest + record sidecars, via
 *    StoragePort.delete (the port has a real delete — no fs reach-around)
 *  - demo users: better-auth internalAdapter hard delete; a rejection (e.g.
 *    the last-admin guard) is counted and reported, never a crash
 *  - seed-added categories: removed from taxonomy/categories.yaml ONLY when no
 *    remaining post references them and no surviving category parents on them
 *
 *  The manifest and checkpoint are cleared afterwards. */
import {
  TAXONOMY_PATH,
  contentPath,
  manifestKey,
  mediaRecordKey,
  parseCategories,
  parseMdoc,
  serializeCategories
} from '@setu/core'
import type { FileChange, MediaManifest, MediaRecord } from '@setu/core'
import { DEMO_DATA_AUTHOR, POSTS_PER_COMMIT, resolveDeps } from './seed'
import { clearCheckpoint, clearManifest, loadManifestStrict } from './state'
import type { RemoveOptions, RemoveSummary } from './types'

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

/** Removal only ever deletes accounts seeding could have created. The
 *  manifest is a plain dev-editable file — a stray hand-added entry must
 *  never turn "unseed" into "delete an arbitrary user". */
export const DEMO_USER_EMAIL = /^demo-[a-z]+-\d+@demo\.setu\.test$/

export async function removeSeeded(
  options: RemoveOptions
): Promise<RemoveSummary> {
  const started = Date.now()
  const { sandboxDir, mediaDir, onProgress } = options
  const deps = await resolveDeps(sandboxDir, mediaDir, options.deps)
  // Strict on purpose: a present-but-corrupt manifest aborts BEFORE anything
  // is removed or cleared (fail closed — see loadManifestStrict).
  const manifest = await loadManifestStrict(sandboxDir)

  if (await deps.probeApiLive()) {
    onProgress?.({
      phase: 'warning',
      message:
        'A dev api appears to be running. git-local is single-writer PER ' +
        'PROCESS — stop `pnpm dev` before removing seeded content.'
    })
  }

  // -- posts: chunked batch-delete commits ------------------------------------
  let postsRemoved = 0
  const existing: string[] = []
  for (const post of manifest.posts) {
    const path = contentPath(post)
    if ((await deps.git.readFile(path)) !== null) existing.push(path)
  }
  for (let i = 0; i < existing.length; i += POSTS_PER_COMMIT) {
    const slice = existing.slice(i, i + POSTS_PER_COMMIT)
    const changes: FileChange[] = slice.map((path) => ({ path, delete: true }))
    await deps.git.commitFiles({
      changes,
      message: `demo-data: remove ${slice.length} seeded posts`,
      author: DEMO_DATA_AUTHOR
    })
    postsRemoved += slice.length
    onProgress?.({
      phase: 'posts',
      done: postsRemoved,
      total: existing.length
    })
  }

  // -- media: sidecar-driven object removal (mirrors the media DELETE route) --
  let mediaRemoved = 0
  for (const mediaKey of manifest.mediaKeys) {
    let any = false
    const manRaw = await deps.storage.get(manifestKey(mediaKey))
    if (manRaw) {
      try {
        const man = JSON.parse(decode(manRaw.body)) as MediaManifest
        await deps.storage.delete(man.original.key)
        for (const v of man.variants) await deps.storage.delete(v.key)
      } catch {
        /* corrupt manifest — still remove the sidecars below */
      }
      await deps.storage.delete(manifestKey(mediaKey))
      any = true
    }
    const recRaw = await deps.storage.get(mediaRecordKey(mediaKey))
    if (recRaw) {
      try {
        const rec = JSON.parse(decode(recRaw.body)) as MediaRecord
        await deps.storage.delete(rec.key)
      } catch {
        /* corrupt record — still remove the sidecar */
      }
      await deps.storage.delete(mediaRecordKey(mediaKey))
      any = true
    }
    if (any) {
      mediaRemoved++
      onProgress?.({
        phase: 'images',
        done: mediaRemoved,
        failed: 0,
        total: manifest.mediaKeys.length
      })
    }
  }

  // -- users: hard delete via the auth seam ------------------------------------
  let usersRemoved = 0
  let userFailures = 0
  let usersSkipped = 0
  for (const user of manifest.users) {
    if (!DEMO_USER_EMAIL.test(user.email)) {
      usersSkipped++
      onProgress?.({
        phase: 'warning',
        message: `manifest lists non-demo user ${user.email} — skipped (removal only deletes demo-*@demo.setu.test accounts)`
      })
      continue
    }
    const found = await deps.users.findByEmail(user.email)
    if (!found) continue
    try {
      await deps.users.deleteById(found.id)
      usersRemoved++
    } catch {
      // e.g. the last-admin guard — honest count, never a crash.
      userFailures++
    }
    onProgress?.({
      phase: 'users',
      done: usersRemoved,
      total: manifest.users.length
    })
  }

  // -- categories: drop seed-added slugs nothing references anymore ------------
  let categoriesRemoved = 0
  if (manifest.categories.length > 0) {
    const referenced = new Set<string>()
    for (const path of await deps.git.list('content/')) {
      if (!path.endsWith('.mdoc')) continue
      const raw = await deps.git.readFile(path)
      if (raw === null) continue
      const cats = parseMdoc(raw).frontmatter['categories']
      if (Array.isArray(cats))
        for (const c of cats) if (typeof c === 'string') referenced.add(c)
    }
    const registry = parseCategories(
      (await deps.git.readFile(TAXONOMY_PATH)) ?? ''
    )
    const seedAdded = new Set(manifest.categories)
    const surviving = registry.filter((c) => !seedAdded.has(c.slug))
    const survivingParents = new Set(
      surviving.map((c) => c.parent).filter((p): p is string => p !== null)
    )
    const keep = registry.filter(
      (c) =>
        !seedAdded.has(c.slug) ||
        referenced.has(c.slug) ||
        survivingParents.has(c.slug)
    )
    categoriesRemoved = registry.length - keep.length
    if (categoriesRemoved > 0) {
      await deps.git.commitFiles({
        changes: [{ path: TAXONOMY_PATH, content: serializeCategories(keep) }],
        message: `demo-data: remove ${categoriesRemoved} seeded categories`,
        author: DEMO_DATA_AUTHOR
      })
    }
    onProgress?.({ phase: 'categories', added: -categoriesRemoved })
  }

  await clearManifest(sandboxDir)
  await clearCheckpoint(sandboxDir)

  return {
    posts: postsRemoved,
    media: mediaRemoved,
    users: usersRemoved,
    userFailures,
    usersSkipped,
    categories: categoriesRemoved,
    durationMs: Date.now() - started
  }
}

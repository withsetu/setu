/** Plan building (#512): stream the pack ONCE and decide, per post — slug,
 *  owner, draft flag, cid, category slugs, tags, image source URL + media key.
 *  Everything except cid minting is pure index arithmetic, so the same inputs
 *  re-plan identically; cross-RUN stability comes from the seed manifest
 *  (packId → slug lets a re-run or a bigger re-seed recognize already-seeded
 *  posts and reuse their slug + committed cid instead of minting duplicates). */
import {
  contentPath,
  isCid,
  mediaKeyOf,
  mediaSlug,
  newCid,
  normalizeTags,
  originalKey,
  parseContentPath,
  parseMdoc
} from '@setu/core'
import type { Category, GitPort, StoragePort } from '@setu/core'
import type { ContentPack, PackLoadOptions } from '../contract'
import { mergeCategoryNames } from './categories'
import { buildOwnerSequence, isDraft } from './partition'
import type { DemoUserSpec } from './partition'
import { uniqueEntrySlug } from './slugs'
import type { SeedManifest } from './state'

export interface PlannedImage {
  url: string
  width: number
  mediaKey: string
  /** `/media/<originalKey>` — what `featuredImage` gets when ingest succeeds. */
  featuredImage: string
}

export interface PostPlan {
  /** Pack post id (stable across runs — the resume/reuse key). */
  id: string
  slug: string
  title: string
  date: string
  cid: string
  draft: boolean
  owner: DemoUserSpec
  categories: string[]
  tags: string[]
  body: string
  image?: PlannedImage
}

export interface SeedPlan {
  posts: PostPlan[]
  /** Full merged category registry to commit (existing entries preserved). */
  categories: Category[]
  /** Category slugs newly added by this plan. */
  addedCategorySlugs: string[]
  /** Pack skip counters observed while streaming. */
  skipped: Record<string, number>
}

export interface BuildPlanOptions {
  pack: ContentPack
  git: GitPort
  storage: StoragePort
  manifest: SeedManifest
  users: DemoUserSpec[]
  posts: number
  collection: string
  locale: string
  draftFraction: number
  imageWidthMix: readonly number[]
  limitImages?: number
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
  /** Existing registry content of taxonomy/categories.yaml (parsed). */
  existingCategories: Category[]
  /** Media keys a same-run checkpoint already assigned (pack post id → key).
   *  Reused verbatim: an interrupted run's storage objects must never trip
   *  the collision ladder into orphaning their own checkpoint entries. */
  priorImageKeys?: ReadonlyMap<string, string>
}

/** Media key for a post image: `<yyyy>/<mm>/<slug>` from the POST's own date
 *  (deterministic across runs, unlike upload-time now()). */
function planMediaKey(date: string, slug: string): string {
  const d = new Date(date)
  return mediaKeyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, mediaSlug(slug))
}

export async function buildPlan(opts: BuildPlanOptions): Promise<SeedPlan> {
  const { git, storage, manifest, collection, locale } = opts

  // Slugs already taken in the target collection/locale: committed entries
  // (git is canonical) — minus nothing; seeded re-runs reuse via the manifest.
  const existingPaths = await git.list(`content/${collection}/${locale}/`)
  const taken = new Set<string>()
  for (const p of existingPaths) {
    const ref = parseContentPath(p)
    if (ref) taken.add(ref.slug)
  }
  const manifestSlugByPackId = new Map(
    manifest.posts
      .filter((p) => p.collection === collection && p.locale === locale)
      .map((p) => [p.packId, p.slug])
  )

  const ownerSequence = buildOwnerSequence(opts.users)
  const posts: PostPlan[] = []
  const plannedSlugs = new Set<string>()
  const categoryNamesByPost: string[][] = []
  const allCategoryNames: string[] = []
  const usedMediaKeys = new Set<string>()
  const manifestMediaKeys = new Set(manifest.mediaKeys)

  const loadOptions: PackLoadOptions = { limit: opts.posts }
  if (opts.signal) loadOptions.signal = opts.signal
  const dataset = opts.pack.load(loadOptions)

  let index = 0
  for await (const post of dataset.posts) {
    // Slug: manifest reuse first (idempotent re-seed), else fresh + dedupe.
    const reusedSlug = manifestSlugByPackId.get(post.id)
    let slug: string
    if (reusedSlug !== undefined && !plannedSlugs.has(reusedSlug)) {
      slug = reusedSlug
      taken.add(slug)
    } else {
      slug = uniqueEntrySlug(post.title, post.id, taken)
    }
    plannedSlugs.add(slug)

    // cid: reuse the committed entry's cid when this slug already exists in
    // git (keeps re-seeding byte-stable → net-empty commits); else mint.
    let cid = newCid()
    if (reusedSlug !== undefined) {
      const committed = await git.readFile(
        contentPath({ collection, locale, slug })
      )
      if (committed !== null) {
        const existingCid = parseMdoc(committed).frontmatter['cid']
        if (isCid(existingCid)) cid = existingCid
      }
    }

    const owner = ownerSequence[index % ownerSequence.length]!
    const draft = isDraft(index, opts.draftFraction)
    const categoryNames = (post.terms['categories'] ?? []).map((n) => n)
    const tags = normalizeTags([...(post.terms['tags'] ?? [])])

    let image: PlannedImage | undefined
    const wantImage =
      post.image !== undefined &&
      (opts.limitImages === undefined || index < opts.limitImages)
    if (post.image && wantImage) {
      const width = opts.imageWidthMix[index % opts.imageWidthMix.length]!
      // Collision ladder: keys used by this plan, and FOREIGN storage objects.
      // A key in the seed manifest counts as ours ONLY for a post that was
      // itself seeded before (reusedSlug) — then the image batch detects the
      // finished ingest and skips the download; anything else occupying the
      // key gets suffixed around, exactly like the upload route.
      const ownPriorKey = (key: string): boolean =>
        reusedSlug !== undefined && manifestMediaKeys.has(key)
      let mediaKey = opts.priorImageKeys?.get(post.id) ?? ''
      if (mediaKey === '') {
        mediaKey = planMediaKey(post.date, slug)
        for (
          let n = 2;
          usedMediaKeys.has(mediaKey) ||
          (!ownPriorKey(mediaKey) &&
            (await storage.exists(originalKey(mediaKey, 'jpg'))));
          n++
        ) {
          mediaKey = `${planMediaKey(post.date, slug)}-${n}`
        }
      }
      usedMediaKeys.add(mediaKey)
      image = {
        url: post.image.urlForWidth(width),
        width,
        mediaKey,
        featuredImage: `/media/${originalKey(mediaKey, 'jpg')}`
      }
    }

    posts.push({
      id: post.id,
      slug,
      title: post.title,
      date: post.date,
      cid,
      draft,
      owner,
      categories: [], // filled below once the registry merge has run
      tags,
      body: post.body,
      ...(image ? { image } : {})
    })
    categoryNamesByPost.push(categoryNames)
    allCategoryNames.push(...categoryNames)
    index++
    opts.onProgress?.(index, opts.posts)
  }

  // Registry merge LAST so category slugs are assigned in one deterministic
  // pass over the whole stream (names repeat heavily across posts).
  const merge = mergeCategoryNames(opts.existingCategories, allCategoryNames)
  for (let i = 0; i < posts.length; i++) {
    const slugs = categoryNamesByPost[i]!.map((name) =>
      merge.slugByName.get(name.trim().toLowerCase())
    ).filter((s): s is string => s !== undefined)
    posts[i]!.categories = [...new Set(slugs)]
  }

  return {
    posts,
    categories: merge.cats,
    addedCategorySlugs: merge.addedSlugs,
    skipped: { ...dataset.stats().skipped }
  }
}

/** Behavioural contract suite every content pack must pass (#511) — the same ports
 *  pattern as `@setu/storage-testing` et al.: packs import this from their own vitest
 *  file and run it against a small local dataset (fixtures — never the network).
 *
 *  Exported on the `@setu/demo-data/contract-suite` subpath (not the main barrel) so
 *  runtime consumers of packs never pull vitest into their module graph.
 */
import { describe, it, expect } from 'vitest'
import { collectPosts } from './contract'
import type { ContentPack, PackPost } from './contract'

export interface ContentPackContractOptions {
  /** Minimum posts the harness dataset must yield (default 1). */
  minPosts?: number
  /** Widths every image ref must produce sane URLs for. */
  widths?: readonly number[]
}

/** Serialize a post for comparison — image refs carry a function, so capture its
 *  observable behaviour (a built URL) instead of the object identity. */
function snapshotPost(
  post: PackPost,
  widths: readonly number[]
): Record<string, unknown> {
  return {
    id: post.id,
    title: post.title,
    body: post.body,
    excerpt: post.excerpt,
    date: post.date,
    sourceAttribution: post.sourceAttribution,
    terms: post.terms,
    image: post.image
      ? {
          license: post.image.license,
          maxWidth: post.image.maxWidth,
          maxHeight: post.image.maxHeight,
          alt: post.image.alt,
          urls: widths.map((w) => post.image!.urlForWidth(w))
        }
      : undefined
  }
}

/** Run the ContentPack behavioural contract against a pack. `makePack` must return
 *  a pack over a FRESH dataset handle on each call (same underlying fixture input). */
export function runContentPackContract(
  makePack: () => ContentPack | Promise<ContentPack>,
  opts: ContentPackContractOptions = {}
): void {
  const minPosts = opts.minPosts ?? 1
  const widths = opts.widths ?? [200, 843, 1686]

  describe('ContentPack contract', () => {
    it('has complete meta (id slug, name, https source citation, license)', async () => {
      const pack = await makePack()
      expect(pack.meta.id).toMatch(/^[a-z0-9][a-z0-9-]*$/)
      expect(pack.meta.name.trim().length).toBeGreaterThan(0)
      expect(pack.meta.license.trim().length).toBeGreaterThan(0)
      const source = new URL(pack.meta.sourceUrl)
      expect(source.protocol).toBe('https:')
    })

    it('yields normalized posts (title/body/excerpt/date/attribution/terms)', async () => {
      const pack = await makePack()
      const posts = await collectPosts(pack.load())
      expect(posts.length).toBeGreaterThanOrEqual(minPosts)
      const seen = new Set<string>()
      for (const post of posts) {
        expect(post.id.trim().length).toBeGreaterThan(0)
        expect(seen.has(post.id)).toBe(false)
        seen.add(post.id)
        expect(post.title.trim().length).toBeGreaterThan(0)
        expect(post.body.trim().length).toBeGreaterThan(0)
        expect(post.excerpt.trim().length).toBeGreaterThan(0)
        expect(post.sourceAttribution.trim().length).toBeGreaterThan(0)
        // Valid ISO 8601: parseable, and survives a Date round-trip.
        const parsed = new Date(post.date)
        expect(Number.isNaN(parsed.getTime())).toBe(false)
        expect(() => parsed.toISOString()).not.toThrow()
        for (const [taxonomy, terms] of Object.entries(post.terms)) {
          expect(taxonomy.trim().length).toBeGreaterThan(0)
          expect(Array.isArray(terms)).toBe(true)
          for (const term of terms)
            expect(term.trim().length).toBeGreaterThan(0)
        }
      }
    })

    it('image refs build sane, width-distinct https URLs and carry a license', async () => {
      const pack = await makePack()
      const posts = await collectPosts(pack.load())
      const withImages = posts.filter((p) => p.image)
      expect(withImages.length).toBeGreaterThanOrEqual(1)
      for (const post of withImages) {
        const image = post.image!
        expect(image.license.trim().length).toBeGreaterThan(0)
        if (image.maxWidth !== undefined)
          expect(image.maxWidth).toBeGreaterThan(0)
        if (image.maxHeight !== undefined)
          expect(image.maxHeight).toBeGreaterThan(0)
        const urls = widths.map((w) => image.urlForWidth(w))
        for (const raw of urls) {
          const url = new URL(raw)
          expect(url.protocol).toBe('https:')
          expect(raw).not.toMatch(/\s/)
        }
        expect(new Set(urls).size).toBe(urls.length)
      }
    })

    it('keeps stats consistent with what was yielded', async () => {
      const pack = await makePack()
      const dataset = pack.load()
      const posts = await collectPosts(dataset)
      const stats = dataset.stats()
      expect(stats.loaded).toBe(posts.length)
      const skippedTotal = Object.values(stats.skipped).reduce(
        (a, b) => a + b,
        0
      )
      expect(stats.scanned).toBe(stats.loaded + skippedTotal)
    })

    it('is deterministic: two loads over the same input yield identical posts', async () => {
      const first = await collectPosts((await makePack()).load())
      const second = await collectPosts((await makePack()).load())
      expect(second.map((p) => snapshotPost(p, widths))).toEqual(
        first.map((p) => snapshotPost(p, widths))
      )
    })

    it('honors the limit option', async () => {
      const pack = await makePack()
      const dataset = pack.load({ limit: 1 })
      const posts = await collectPosts(dataset)
      expect(posts.length).toBe(1)
      expect(dataset.stats().loaded).toBe(1)
    })
  })
}

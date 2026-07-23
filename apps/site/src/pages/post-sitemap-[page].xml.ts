import type { APIContext, GetStaticPaths } from 'astro'
import { resolveMediaBase } from '@setu/image-astro'
import { loadSiteSettings } from '../lib/site-settings'
import { loadSitemapEntries } from '../lib/sitemap-entries'
import { permalinkMap } from '../lib/permalinks'
import {
  collectSitemapSections,
  chunkSitemapUrls,
  urlSitemapXml
} from '../lib/sitemap'

export const prerender = true
const SITE_FALLBACK = 'http://localhost:4321'

// One prerendered shard per ≤50,000-URL chunk of the post sitemap (#859 SITE-03) — a single
// unbounded `<urlset>` is rejected past the sitemaps.org cap. getStaticPaths computes the chunks
// once and hands each shard's serialized XML to GET via props (a single-pass emit), and it uses the
// SAME deterministic chunker as the sitemap index in sitemap.xml.ts, so the shard files this route
// generates (`post-sitemap-1.xml`, `-2.xml`, …) are exactly the ones the index references.
export const getStaticPaths = (async () => {
  const settings = loadSiteSettings()
  // getStaticPaths has no `context.site`; the configured site is SETU_SITE_URL (astro.config), so
  // the shard locs match the index, which derives the same value from `context.site`.
  const siteUrl = process.env.SETU_SITE_URL ?? SITE_FALLBACK
  const mediaBase = resolveMediaBase(
    import.meta.env.PUBLIC_SETU_MEDIA,
    import.meta.env.DEV
  )
  const entries = await loadSitemapEntries()
  const map = await permalinkMap()
  const urls = collectSitemapSections(
    entries,
    settings.reading.sitemap,
    siteUrl,
    settings.reading.homepage,
    mediaBase,
    (id) => map.get(id)
  ).post
  // Empty (disabled section or no posts) → no shards; the index then lists no post section.
  return chunkSitemapUrls(urls).map((chunk, i) => ({
    params: { page: String(i + 1) },
    props: { xml: urlSitemapXml(chunk) }
  }))
}) satisfies GetStaticPaths

export function GET({ props }: APIContext): Response {
  const xml = (props as { xml?: string }).xml
  if (!xml) return new Response(null, { status: 404 })
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  })
}

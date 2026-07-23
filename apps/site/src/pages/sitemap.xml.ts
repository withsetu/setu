import type { APIContext } from 'astro'
import { loadSiteSettings } from '../lib/site-settings'
import { loadSitemapEntries } from '../lib/sitemap-entries'
import { permalinkMap } from '../lib/permalinks'
import {
  collectSitemapSections,
  sitemapIndexXml,
  newestLastmod,
  chunkSitemapUrls,
  type SitemapSection,
  type SitemapSectionKey
} from '../lib/sitemap'

export const prerender = true

const SITE_FALLBACK = 'http://localhost:4321'
// The post section is sharded (see below); the single-file sections keep their fixed names.
const FILE: Record<Exclude<SitemapSectionKey, 'post'>, string> = {
  page: 'page-sitemap.xml',
  category: 'category-sitemap.xml',
  tag: 'tag-sitemap.xml'
}

export async function GET(context: APIContext) {
  const settings = loadSiteSettings()
  const siteUrl = context.site?.href ?? SITE_FALLBACK
  const base = siteUrl.replace(/\/+$/, '')
  const entries = await loadSitemapEntries()
  const map = await permalinkMap()
  const sections = collectSitemapSections(
    entries,
    settings.reading.sitemap,
    siteUrl,
    settings.reading.homepage,
    '',
    (id) => map.get(id)
  )
  // Only list sub-sitemaps that are enabled AND have URLs. The post section expands to one entry
  // per ≤50k shard the post-sitemap-[page] route generates (#859); the rest are single files.
  const index: SitemapSection[] = []
  for (const k of Object.keys(sections) as SitemapSectionKey[]) {
    const urls = sections[k]
    if (urls.length === 0) continue
    if (k === 'post') {
      chunkSitemapUrls(urls).forEach((chunk, i) =>
        index.push({
          loc: `${base}/post-sitemap-${i + 1}.xml`,
          lastmod: newestLastmod(chunk)
        })
      )
    } else {
      index.push({ loc: `${base}/${FILE[k]}`, lastmod: newestLastmod(urls) })
    }
  }
  return new Response(sitemapIndexXml(index), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  })
}

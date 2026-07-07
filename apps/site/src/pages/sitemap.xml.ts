import type { APIContext } from 'astro'
import { loadSiteSettings } from '../lib/site-settings'
import { loadSitemapEntries } from '../lib/sitemap-entries'
import { permalinkMap } from '../lib/permalinks'
import {
  collectSitemapSections,
  sitemapIndexXml,
  newestLastmod,
  type SitemapSectionKey
} from '../lib/sitemap'

export const prerender = true

const SITE_FALLBACK = 'http://localhost:4321'
const FILE: Record<SitemapSectionKey, string> = {
  post: 'post-sitemap.xml',
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
  // Only list sub-sitemaps that are enabled AND have URLs.
  const index = (Object.keys(sections) as SitemapSectionKey[])
    .filter((k) => sections[k].length > 0)
    .map((k) => ({
      loc: `${base}/${FILE[k]}`,
      lastmod: newestLastmod(sections[k])
    }))
  return new Response(sitemapIndexXml(index), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  })
}

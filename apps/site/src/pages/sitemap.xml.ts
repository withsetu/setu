import type { APIContext } from 'astro'
import { loadSiteSettings } from '../lib/site-settings'
import { loadSitemapEntries } from '../lib/sitemap-entries'
import { permalinkMap } from '../lib/permalinks'
import {
  collectSitemapSections,
  sitemapIndexEntries,
  sitemapIndexXml
} from '../lib/sitemap'

export const prerender = true

const SITE_FALLBACK = 'http://localhost:4321'

export async function GET(context: APIContext) {
  const settings = loadSiteSettings()
  const siteUrl = context.site?.href ?? SITE_FALLBACK
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
  const index = sitemapIndexEntries(sections, siteUrl)
  // Every section disabled or empty → no valid index exists (a <sitemapindex> needs ≥1 child):
  // no file (404), same as the leaf routes, and robots.txt omits its Sitemap line (#1120).
  if (index.length === 0) return new Response(null, { status: 404 })
  return new Response(sitemapIndexXml(index), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  })
}

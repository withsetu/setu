import type { APIContext } from 'astro'
import { loadSiteSettings } from '../lib/site-settings'
import { loadSitemapEntries } from '../lib/sitemap-entries'
import { permalinkMap } from '../lib/permalinks'
import {
  buildRobotsTxt,
  collectSitemapSections,
  sitemapIndexEntries
} from '../lib/sitemap'

export const prerender = true

const SITE_FALLBACK = 'http://localhost:4321'

export async function GET(context: APIContext) {
  const settings = loadSiteSettings()
  const siteUrl = context.site?.href ?? SITE_FALLBACK
  // Advertise /sitemap.xml only when that route emits one — the SAME index computation, so the
  // two cannot disagree (#1120). Skipped entirely when the site is search-hidden.
  let hasSitemap = false
  if (settings.reading.searchEngineVisible) {
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
    hasSitemap = sitemapIndexEntries(sections, siteUrl).length > 0
  }
  const body = buildRobotsTxt(
    settings.reading.searchEngineVisible,
    siteUrl,
    hasSitemap
  )
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}

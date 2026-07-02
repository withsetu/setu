import type { APIContext } from 'astro'
import { loadSiteSettings } from '../lib/site-settings'
import { loadSitemapEntries } from '../lib/sitemap-entries'
import { collectSitemapSections, urlSitemapXml } from '../lib/sitemap'

export const prerender = true
const SITE_FALLBACK = 'http://localhost:4321'

export async function GET(context: APIContext) {
  const settings = loadSiteSettings()
  const siteUrl = context.site?.href ?? SITE_FALLBACK
  const entries = await loadSitemapEntries()
  const urls = collectSitemapSections(entries, settings.reading.sitemap, siteUrl, settings.reading.homepage).category
  // Disabled section or nothing to list → no file (404).
  if (urls.length === 0) return new Response(null, { status: 404 })
  return new Response(urlSitemapXml(urls), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}

import { getCollection } from 'astro:content'
import type { APIContext } from 'astro'
import { loadSiteSettings } from '../lib/site-settings'
import { resolvePostDate } from '../lib/post-date'
import { buildSitemap, type SitemapEntry } from '../lib/sitemap'

export const prerender = true

// A prod build sets SETU_SITE_URL (→ context.site); the localhost fallback mirrors astro.config.
const SITE_FALLBACK = 'http://localhost:4321'

export async function GET(context: APIContext) {
  const settings = loadSiteSettings()
  const siteUrl = context.site?.href ?? SITE_FALLBACK
  const entries = await getCollection('entries')
  const rows: SitemapEntry[] = entries.map((e) => {
    const data = e.data as Record<string, unknown>
    return { id: e.id, data, lastmod: resolvePostDate({ data, filePath: e.filePath }).toISOString() }
  })
  const xml = buildSitemap(rows, siteUrl, settings.reading.homepage)
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } })
}

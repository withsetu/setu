import { parsePageSeoOverride } from '@setu/core'
import { toUrlPath } from './url'

export interface SitemapEntry {
  id: string
  data: Record<string, unknown>
  /** ISO 8601 last-modified date (optional; omitted from the entry when absent). */
  lastmod?: string
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Build a urlset sitemap over published, indexable entries. Excludes `published:false` and any
 * page with a `seo.noindex` override (they must not be advertised for crawling). The homepage is
 * listed once at the site root; the home entry itself is skipped to avoid a duplicate. Pure.
 */
export function buildSitemap(entries: SitemapEntry[], siteUrl: string, homepageId: string): string {
  const base = siteUrl.replace(/\/+$/, '')
  const urls: { loc: string; lastmod?: string }[] = [{ loc: `${base}/` }]

  for (const e of entries) {
    if (e.data['published'] === false) continue
    if (parsePageSeoOverride(e.data).noindex) continue
    if (e.id === homepageId || e.id === 'page/en/home') continue // already at '/'
    const path = toUrlPath(e.id)
    if (!path) continue
    urls.push({ loc: `${base}/${path}/`, lastmod: e.lastmod })
  }

  const body = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}\n  </url>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

/** Build the /robots.txt body. Search-hidden sites disallow all; visible sites allow all and
 *  advertise the sitemap. `siteUrl` is the absolute site base. */
export function buildRobotsTxt(searchEngineVisible: boolean, siteUrl: string): string {
  if (!searchEngineVisible) {
    return 'User-agent: *\nDisallow: /\n'
  }
  const base = siteUrl.replace(/\/+$/, '')
  return `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`
}

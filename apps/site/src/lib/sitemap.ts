import { parsePageSeoOverride, distinctCategorySlugs, distinctTagSlugs, DEFAULT_LOCALE } from '@setu/core'
import { toUrlPath } from './url'
import { toPostRow } from './post-row'

/** Each sitemap references the stylesheet so browsers render it as a styled page (see public/sitemap.xsl). */
export const SITEMAP_XSL = '<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>'

const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9'

export interface SitemapUrl {
  loc: string
  lastmod?: string
}

/** A sub-sitemap reference in the index. */
export interface SitemapSection {
  loc: string
  lastmod?: string
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const locBlock = (tag: 'url' | 'sitemap', item: SitemapUrl): string =>
  `  <${tag}>\n    <loc>${xmlEscape(item.loc)}</loc>${item.lastmod ? `\n    <lastmod>${item.lastmod}</lastmod>` : ''}\n  </${tag}>`

/** The sitemap index — a `<sitemapindex>` of the enabled sub-sitemaps. */
export function sitemapIndexXml(sections: SitemapSection[]): string {
  const body = sections.map((s) => locBlock('sitemap', s)).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n${SITEMAP_XSL}\n<sitemapindex xmlns="${NS}">\n${body}\n</sitemapindex>\n`
}

/** A leaf `<urlset>` sub-sitemap. */
export function urlSitemapXml(urls: SitemapUrl[]): string {
  const body = urls.map((u) => locBlock('url', u)).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n${SITEMAP_XSL}\n<urlset xmlns="${NS}">\n${body}\n</urlset>\n`
}

/** Published (committed and not `published:false`) and not per-page `seo.noindex`. */
export function isIndexable(data: Record<string, unknown>): boolean {
  return data['published'] !== false && !parsePageSeoOverride(data).noindex
}

export interface SitemapEntry {
  id: string
  data: Record<string, unknown>
  /** ISO 8601 last-modified (optional). */
  lastmod?: string
}

/** Absolute URLs for the indexable entries of one collection ('post' | 'page'). The homepage is
 *  attributed to the 'page' section (listed once at the site root; the home entry is skipped). */
export function entryUrls(
  entries: SitemapEntry[],
  collection: 'post' | 'page',
  siteUrl: string,
  homepageId: string,
): SitemapUrl[] {
  const base = siteUrl.replace(/\/+$/, '')
  const urls: SitemapUrl[] = []
  if (collection === 'page') urls.push({ loc: `${base}/` })
  for (const e of entries) {
    if (e.id === homepageId || e.id === 'page/en/home') continue // already at '/'
    if (e.id.split('/')[0] !== collection) continue
    if (!isIndexable(e.data)) continue
    const path = toUrlPath(e.id)
    if (!path) continue
    urls.push({ loc: `${base}/${path}/`, lastmod: e.lastmod })
  }
  return urls
}

/** Absolute taxonomy-archive URLs (category or tag) from a list of slugs. */
export function taxonomyUrls(slugs: string[], kind: 'category' | 'tag', siteUrl: string): SitemapUrl[] {
  const base = siteUrl.replace(/\/+$/, '')
  return slugs.map((slug) => ({ loc: `${base}/${kind}/${slug}/` }))
}

/** Newest lastmod across a set of URLs (for a sub-sitemap's `<lastmod>` in the index). */
export function newestLastmod(urls: SitemapUrl[]): string | undefined {
  return urls
    .map((u) => u.lastmod)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1)
}

export interface SitemapConfig {
  posts: boolean
  pages: boolean
  categories: boolean
  tags: boolean
}
export type SitemapSectionKey = 'post' | 'page' | 'category' | 'tag'

/** Collect the URL list for every sitemap section, honoring the include/exclude config. Disabled
 *  sections come back empty. Taxonomy slugs are derived from the published, indexable posts (so the
 *  sitemap lists exactly the archive pages that exist). */
export function collectSitemapSections(
  entries: SitemapEntry[],
  cfg: SitemapConfig,
  siteUrl: string,
  homepageId: string,
): Record<SitemapSectionKey, SitemapUrl[]> {
  const postRows = entries
    .filter((e) => e.id.split('/')[0] === 'post' && isIndexable(e.data))
    .map((e) => toPostRow({ id: e.id, data: e.data }))
  return {
    post: cfg.posts ? entryUrls(entries, 'post', siteUrl, homepageId) : [],
    page: cfg.pages ? entryUrls(entries, 'page', siteUrl, homepageId) : [],
    category: cfg.categories
      ? taxonomyUrls(distinctCategorySlugs(postRows, DEFAULT_LOCALE), 'category', siteUrl)
      : [],
    tag: cfg.tags ? taxonomyUrls(distinctTagSlugs(postRows, DEFAULT_LOCALE), 'tag', siteUrl) : [],
  }
}

/** Build the /robots.txt body. Search-hidden sites disallow all; visible sites allow all and
 *  advertise the sitemap index. `siteUrl` is the absolute site base. */
export function buildRobotsTxt(searchEngineVisible: boolean, siteUrl: string): string {
  if (!searchEngineVisible) return 'User-agent: *\nDisallow: /\n'
  const base = siteUrl.replace(/\/+$/, '')
  return `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`
}

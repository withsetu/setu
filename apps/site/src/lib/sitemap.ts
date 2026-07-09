import {
  parsePageSeoOverride,
  distinctCategorySlugs,
  distinctTagSlugs,
  DEFAULT_LOCALE,
  entryUrlPath,
  extractEmbedVideos
} from '@setu/core'
import { toPostRow } from './post-row'

/** URL-path resolver: content id → path (no leading/trailing slash), or undefined if the id
 *  has no page. Callers that see the whole site (the sitemap endpoints) pass the collision-aware
 *  permalink map so the sitemap lists the SAME URLs the pages are actually served at. */
export type UrlPathResolver = (id: string) => string | undefined

/** Default resolver — the legacy ':collection/:slug' scheme, upgrade-safe and used by the unit
 *  tests. Endpoints override it with the permalink map (which honors configured patterns). */
const defaultUrlPath: UrlPathResolver = (id) => {
  const [collection = '', locale = '', ...rest] = id.split('/')
  return entryUrlPath({ collection, locale, slug: rest.join('/') })
}

/** Each sitemap references the stylesheet so browsers render it as a styled page (see public/sitemap.xsl). */
export const SITEMAP_XSL =
  '<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>'

const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9'
const IMAGE_NS = 'http://www.google.com/schemas/sitemap-image/1.1'
const VIDEO_NS = 'http://www.google.com/schemas/sitemap-video/1.1'

/** A `<video:video>` entry — Google requires thumbnail_loc, title, description, and a player_loc
 *  (or content_loc). All absolute; description defaults to the title when the embed has no caption. */
export interface SitemapVideo {
  thumbnailLoc: string
  title: string
  description: string
  playerLoc: string
}

export interface SitemapUrl {
  loc: string
  lastmod?: string
  /** Absolute image URLs on this page → <image:image> entries (Google image sitemap). */
  images?: string[]
  /** Video embeds on this page → <video:video> entries (Google video sitemap, #367). */
  videos?: SitemapVideo[]
}

/** A sub-sitemap reference in the index. */
export interface SitemapSection {
  loc: string
  lastmod?: string
}

const xmlEscape = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const locBlock = (tag: 'url' | 'sitemap', item: SitemapUrl): string => {
  const images = (item.images ?? [])
    .map(
      (img) =>
        `\n    <image:image>\n      <image:loc>${xmlEscape(img)}</image:loc>\n    </image:image>`
    )
    .join('')
  const videos = (item.videos ?? [])
    .map(
      (v) =>
        `\n    <video:video>\n      <video:thumbnail_loc>${xmlEscape(v.thumbnailLoc)}</video:thumbnail_loc>\n      <video:title>${xmlEscape(v.title)}</video:title>\n      <video:description>${xmlEscape(v.description)}</video:description>\n      <video:player_loc>${xmlEscape(v.playerLoc)}</video:player_loc>\n    </video:video>`
    )
    .join('')
  return `  <${tag}>\n    <loc>${xmlEscape(item.loc)}</loc>${item.lastmod ? `\n    <lastmod>${item.lastmod}</lastmod>` : ''}${images}${videos}\n  </${tag}>`
}

/** The sitemap index — a `<sitemapindex>` of the enabled sub-sitemaps. */
export function sitemapIndexXml(sections: SitemapSection[]): string {
  const body = sections.map((s) => locBlock('sitemap', s)).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n${SITEMAP_XSL}\n<sitemapindex xmlns="${NS}">\n${body}\n</sitemapindex>\n`
}

/** A leaf `<urlset>` sub-sitemap (with the Google image namespace when any URL carries images). */
export function urlSitemapXml(urls: SitemapUrl[]): string {
  const hasImages = urls.some((u) => u.images?.length)
  const hasVideos = urls.some((u) => u.videos?.length)
  const ns = `xmlns="${NS}"${hasImages ? ` xmlns:image="${IMAGE_NS}"` : ''}${hasVideos ? ` xmlns:video="${VIDEO_NS}"` : ''}`
  const body = urls.map((u) => locBlock('url', u)).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n${SITEMAP_XSL}\n<urlset ${ns}>\n${body}\n</urlset>\n`
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
  /** Raw document body — scanned for in-body image URLs. */
  body?: string
}

const IMG_EXT = /\.(?:jpe?g|png|gif|webp|avif|svg)$/i
// Image URL candidates in a body: /media/... paths and absolute http(s) URLs.
const BODY_URL = /(?:https?:\/\/[^\s"')<>]+|\/media\/[^\s"')<>]+)/g

/** All image URLs for an entry — the featured image + in-body images — resolved to absolute
 *  (`/media/…` through the media base, then everything against the site origin). Deduped, ordered
 *  featured-first. Feeds `<image:image>` entries (Google image sitemap). */
export function entryImages(
  e: SitemapEntry,
  mediaBase: string,
  siteUrl: string
): string[] {
  const base = siteUrl.replace(/\/+$/, '')
  const resolve = (raw: string): string => {
    const viaMedia = raw.startsWith('/media/') ? `${mediaBase}${raw}` : raw
    return /^https?:\/\//i.test(viaMedia)
      ? viaMedia
      : `${base}${viaMedia.startsWith('/') ? '' : '/'}${viaMedia}`
  }
  const out: string[] = []
  const seen = new Set<string>()
  const add = (raw: string | undefined) => {
    if (!raw || !IMG_EXT.test(raw.split('?')[0] ?? '')) return
    const abs = resolve(raw)
    if (!seen.has(abs)) {
      seen.add(abs)
      out.push(abs)
    }
  }
  const fm = e.data['featuredImage']
  add(typeof fm === 'string' ? fm : undefined)
  for (const m of (e.body ?? '').matchAll(BODY_URL)) add(m[0])
  return out
}

/** Video embeds on an entry → `<video:video>` entries (#367). Sourced from the stored embed-block
 *  props (title/thumbnail/player URL); URLs resolved absolute; description falls back to the title
 *  when the embed has no caption (Google requires a description). */
export function entryVideos(
  e: SitemapEntry,
  mediaBase: string,
  siteUrl: string
): SitemapVideo[] {
  const base = siteUrl.replace(/\/+$/, '')
  const abs = (raw: string): string => {
    const viaMedia = raw.startsWith('/media/') ? `${mediaBase}${raw}` : raw
    return /^https?:\/\//i.test(viaMedia)
      ? viaMedia
      : `${base}${viaMedia.startsWith('/') ? '' : '/'}${viaMedia}`
  }
  return extractEmbedVideos(e.body ?? '').map((v) => ({
    thumbnailLoc: abs(v.thumbnailUrl),
    title: v.title,
    description: v.description ?? v.title,
    playerLoc: abs(v.playerLoc)
  }))
}

/** Absolute URLs for the indexable entries of one collection ('post' | 'page'). The homepage is
 *  attributed to the 'page' section (listed once at the site root; the home entry is skipped). */
export function entryUrls(
  entries: SitemapEntry[],
  collection: 'post' | 'page',
  siteUrl: string,
  homepageId: string,
  mediaBase = '',
  urlPath: UrlPathResolver = defaultUrlPath
): SitemapUrl[] {
  const base = siteUrl.replace(/\/+$/, '')
  const urls: SitemapUrl[] = []
  if (collection === 'page') urls.push({ loc: `${base}/` })
  for (const e of entries) {
    if (e.id === homepageId || e.id === 'page/en/home') continue // already at '/'
    if (e.id.split('/')[0] !== collection) continue
    if (!isIndexable(e.data)) continue
    const path = urlPath(e.id)
    if (!path) continue
    const images = entryImages(e, mediaBase, siteUrl)
    const videos = entryVideos(e, mediaBase, siteUrl)
    urls.push({
      loc: `${base}/${path}/`,
      lastmod: e.lastmod,
      ...(images.length ? { images } : {}),
      ...(videos.length ? { videos } : {})
    })
  }
  return urls
}

/** Absolute taxonomy-archive URLs (category or tag) from a list of slugs. */
export function taxonomyUrls(
  slugs: string[],
  kind: 'category' | 'tag',
  siteUrl: string
): SitemapUrl[] {
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
  mediaBase = '',
  urlPath: UrlPathResolver = defaultUrlPath
): Record<SitemapSectionKey, SitemapUrl[]> {
  const postRows = entries
    .filter((e) => e.id.split('/')[0] === 'post' && isIndexable(e.data))
    .map((e) => toPostRow({ id: e.id, data: e.data }))
  return {
    post: cfg.posts
      ? entryUrls(entries, 'post', siteUrl, homepageId, mediaBase, urlPath)
      : [],
    page: cfg.pages
      ? entryUrls(entries, 'page', siteUrl, homepageId, mediaBase, urlPath)
      : [],
    category: cfg.categories
      ? taxonomyUrls(
          distinctCategorySlugs(postRows, DEFAULT_LOCALE),
          'category',
          siteUrl
        )
      : [],
    tag: cfg.tags
      ? taxonomyUrls(distinctTagSlugs(postRows, DEFAULT_LOCALE), 'tag', siteUrl)
      : []
  }
}

/** Build the /robots.txt body. Search-hidden sites disallow all; visible sites allow all and
 *  advertise the sitemap index. `siteUrl` is the absolute site base. */
export function buildRobotsTxt(
  searchEngineVisible: boolean,
  siteUrl: string
): string {
  if (!searchEngineVisible) return 'User-agent: *\nDisallow: /\n'
  const base = siteUrl.replace(/\/+$/, '')
  return `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`
}

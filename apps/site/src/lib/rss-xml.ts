import type { RSSFeedItem, RSSOptions } from '@astrojs/rss'
import { GENERATOR_URL } from '@setu/core'
import { resolveMediaBase } from '@setu/image-astro'
import type { FeedItem } from './feed'

/** Namespaces added to the <rss> root so the extra channel/item elements validate. */
export const FEED_XMLNS = {
  atom: 'http://www.w3.org/2005/Atom',
  media: 'http://search.yahoo.com/mrss/'
}

/** Escape the five XML entities for safe interpolation into raw `customData` strings. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Raw XML injected into <channel>: language, lastBuildDate, generator, atom:self. */
export function channelExtras(opts: {
  locale: string
  selfUrl: string
  lastBuild: Date | null
}): string {
  return [
    `<language>${xmlEscape(opts.locale)}</language>`,
    opts.lastBuild
      ? `<lastBuildDate>${opts.lastBuild.toUTCString()}</lastBuildDate>`
      : '',
    `<generator>${xmlEscape(GENERATOR_URL)}</generator>`,
    `<atom:link href="${xmlEscape(opts.selfUrl)}" rel="self" type="application/rss+xml" />`
  ]
    .filter(Boolean)
    .join('')
}

/** Resolve a raw featured-image value to an absolute URL for `<media:content>`:
 *  pass through external http(s) URLs as-is; resolve `/media/...` paths against the media base
 *  and the site origin. Returns undefined when there's no image. */
export function mediaItemUrl(
  image: string | undefined,
  mediaBase: string,
  site: string
): string | undefined {
  if (!image) return undefined
  if (/^https?:\/\//i.test(image)) return image
  const rel = image.startsWith('/') ? `${mediaBase}${image}` : image
  return new URL(rel, site).href
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif'
}

function mimeFromUrl(url: string): string | undefined {
  const ext = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase()
  return ext ? MIME_BY_EXT[ext] : undefined
}

/** Map a FeedItem to an `@astrojs/rss` item, adding `<category>` entries and a `<media:content>`
 *  element (when an absolute image URL is supplied). */
export function toRssItem(
  item: FeedItem,
  absImageUrl: string | undefined
): RSSFeedItem {
  const out: RSSFeedItem = {
    title: item.title,
    link: item.link,
    pubDate: item.pubDate,
    description: item.description
  }
  if (item.categories.length) out.categories = item.categories
  if (absImageUrl) {
    const mime = mimeFromUrl(absImageUrl)
    out.customData = `<media:content url="${xmlEscape(absImageUrl)}" medium="image"${mime ? ` type="${mime}"` : ''} />`
  }
  return out
}

/** Assemble the full `@astrojs/rss` options for a feed — shared by the default and per-locale
 *  endpoints so they can't drift. Resolves per-item media URLs and the channel furniture. */
export function buildFeed(opts: {
  title: string
  description: string
  site: string | URL | undefined
  locale: string
  /** Path of this feed relative to the site root, e.g. `rss.xml` or `fr/rss.xml`. */
  feedPath: string
  items: FeedItem[]
}): RSSOptions {
  // Guarantee a trailing slash so the relative `feedPath` (e.g. `rss.xml`, `fr/rss.xml`) resolves
  // under the site root rather than replacing its last path segment (defensive — Astro normalizes
  // `context.site` with a trailing slash, but the fallback / a future base path might not).
  const base = (opts.site ?? 'http://localhost:4321').toString()
  const site = base.endsWith('/') ? base : `${base}/`
  const mediaBase = resolveMediaBase(
    import.meta.env.PUBLIC_SETU_MEDIA,
    import.meta.env.DEV
  )
  const selfUrl = new URL(opts.feedPath, site).href
  const lastBuild = opts.items.reduce<Date | null>(
    (max, it) => (!max || it.pubDate > max ? it.pubDate : max),
    null
  )
  return {
    title: opts.title,
    description: opts.description,
    site,
    xmlns: FEED_XMLNS,
    customData: channelExtras({ locale: opts.locale, selfUrl, lastBuild }),
    items: opts.items.map((it) =>
      toRssItem(it, mediaItemUrl(it.image, mediaBase, site))
    )
  }
}

import type { RSSFeedItem, RSSOptions } from '@astrojs/rss'
import { GENERATOR_URL } from '@setu/core'
import { resolveMediaBase } from '@setu/image-astro'
import type { FeedItem } from './feed'

/** Namespaces added to the <rss> root so the extra channel/item elements validate. */
export const FEED_XMLNS = {
  atom: 'http://www.w3.org/2005/Atom',
  media: 'http://search.yahoo.com/mrss/',
  dc: 'http://purl.org/dc/elements/1.1/'
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
  /** Absolute site-logo URL + channel title/link for the RSS `<image>` element (#77). */
  image?: { url: string; title: string; link: string }
}): string {
  return [
    `<language>${xmlEscape(opts.locale)}</language>`,
    opts.image
      ? `<image><url>${xmlEscape(opts.image.url)}</url><title>${xmlEscape(opts.image.title)}</title><link>${xmlEscape(opts.image.link)}</link></image>`
      : '',
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
  absImageUrl: string | undefined,
  /** Feed-level creator fallback; a per-item `author` wins (#77). Empty → no dc:creator. */
  creator?: string
): RSSFeedItem {
  const out: RSSFeedItem = {
    title: item.title,
    link: item.link,
    pubDate: item.pubDate,
    description: item.description
  }
  if (item.categories.length) out.categories = item.categories
  const custom: string[] = []
  const by = item.author || creator
  if (by) custom.push(`<dc:creator>${xmlEscape(by)}</dc:creator>`)
  if (absImageUrl) {
    const mime = mimeFromUrl(absImageUrl)
    custom.push(
      `<media:content url="${xmlEscape(absImageUrl)}" medium="image"${mime ? ` type="${mime}"` : ''} />`
    )
  }
  if (custom.length) out.customData = custom.join('')
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
  /** Raw site-logo media path/URL (identity.logo) — resolved like featured images and
   *  emitted as the channel `<image>` when set (#77). */
  channelImage?: string
  /** Feed-level `<dc:creator>` for items without their own author (#77) —
   *  identity.name, falling back to the site title. Empty → omitted. */
  creator?: string
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
  const imageUrl = mediaItemUrl(opts.channelImage, mediaBase, site)
  return {
    title: opts.title,
    description: opts.description,
    site,
    xmlns: FEED_XMLNS,
    customData: channelExtras({
      locale: opts.locale,
      selfUrl,
      lastBuild,
      image: imageUrl
        ? { url: imageUrl, title: opts.title, link: site }
        : undefined
    }),
    items: opts.items.map((it) =>
      toRssItem(it, mediaItemUrl(it.image, mediaBase, site), opts.creator)
    )
  }
}

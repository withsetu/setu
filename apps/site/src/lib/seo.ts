import {
  resolveSeo,
  resolveJsonLd,
  jsonLdScript,
  DEFAULT_LOCALE,
  type SiteSettings,
  type ResolvedSeo
} from '@setu/core'
import { manifestKeyFromSrc, loadManifest } from '@setu/image-astro'

export interface PageSeoInput {
  /** Page title (post/page title); empty → homepage (site name only). */
  title?: string
  /** Page-level description (frontmatter); falls back to the site description. */
  description?: string
  /** og:type — posts are 'article', everything else 'website'. */
  type?: 'website' | 'article'
  /** BCP-47 locale (og:locale). */
  locale?: string
  /** Raw image path/URL (e.g. frontmatter `featuredImage` `/media/…` or an absolute URL).
   *  Resolved through the media base + absolutized; falls back to identity.defaultImage. */
  imagePath?: string
  /** ISO 8601 publish date (JSON-LD datePublished, posts). */
  datePublished?: string
  /** ISO 8601 modified date (JSON-LD dateModified, posts). */
  dateModified?: string
  /** Per-page override: force noindex,nofollow. */
  noindex?: boolean
  /** Per-page canonical override (absolute or root-relative); replaces the derived canonical. */
  canonical?: string
  /** Previous paginated page path (Astro `page.url.prev`) → <link rel="prev">. */
  prevPath?: string
  /** Next paginated page path (Astro `page.url.next`) → <link rel="next">. */
  nextPath?: string
  /** Locale variants of this same entry (same collection+slug) → <link rel="alternate" hreflang>.
   *  Each `path` is a root-relative permalink (absolutized here). Fewer than 2 → no hreflang. */
  alternates?: { locale: string; path: string }[]
}

/** Build absolute hreflang alternate links from an entry's locale variants, appending an
 *  `x-default` pointing at the default-locale variant (or the first, if the default is absent).
 *  Fewer than 2 variants → undefined (a lone hreflang is meaningless). */
const buildAlternates = (
  variants: { locale: string; path: string }[] | undefined,
  base: URL
): { hreflang: string; href: string }[] | undefined => {
  if (!variants || variants.length < 2) return undefined
  const links = variants.map((v) => ({
    hreflang: v.locale,
    href: new URL(v.path, base).href
  }))
  const def = variants.find((v) => v.locale === DEFAULT_LOCALE) ?? variants[0]
  links.push({ hreflang: 'x-default', href: new URL(def.path, base).href })
  return links
}

/** Media-resolve a raw path (prepend the media base for root-relative `/media/…`) then absolutize
 *  it against the site origin. Returns undefined for an empty input. */
const absMedia = (
  raw: string,
  mediaBase: string,
  base: URL
): string | undefined => {
  if (!raw) return undefined
  const viaMedia =
    !/^https?:\/\//i.test(raw) && raw.startsWith('/')
      ? `${mediaBase}${raw}`
      : raw
  return new URL(viaMedia, base).href
}

/**
 * Build the page's resolved SEO head: assemble an absolute canonical from `Astro.site` + path,
 * resolve the share image through the media base and absolutize it, then delegate the tag set to
 * @setu/core's `resolveSeo`. og:image / og:url / canonical must be absolute, so everything is
 * resolved against the site origin here (the pure core resolver stays URL-agnostic).
 */
export function pageSeo(
  site: URL | undefined,
  pathname: string,
  mediaBase: string,
  settings: SiteSettings,
  page: PageSeoInput = {}
): ResolvedSeo {
  // A prod build sets SETU_SITE_URL (→ Astro.site); the localhost fallback mirrors astro.config.
  const base = site ?? new URL('http://localhost:4321')
  // A per-page canonical override (absolute or root-relative) wins; else derive from the path.
  const canonical = new URL(page.canonical || pathname, base).href

  const rawImage = page.imagePath || settings.identity.defaultImage || ''
  const image = absMedia(rawImage, mediaBase, base)
  const logo = absMedia(settings.identity.logo || '', mediaBase, base)

  // Intrinsic dimensions + type for og:image:* come from the media manifest (build-time fs read);
  // external/non-media images have no manifest, so the bare og:image is emitted. Alt mirrors the
  // theme's featured-image convention (alt = page title). See #215.
  const key = manifestKeyFromSrc(rawImage)
  const manifest = key ? loadManifest(key) : null

  const seo = resolveSeo(settings, {
    title: page.title,
    description: page.description,
    type: page.type,
    locale: page.locale,
    image,
    imageWidth: manifest?.original.width,
    imageHeight: manifest?.original.height,
    imageType: manifest ? `image/${manifest.original.format}` : undefined,
    imageAlt: image && page.title ? page.title : undefined,
    canonical,
    noindex: page.noindex
  })

  // JSON-LD @graph (#72) — reuses the resolved absolute URLs; attached as an escaped script string.
  const graph = resolveJsonLd(settings, {
    siteUrl: base.href,
    canonical,
    pageTitle: page.title ?? '',
    description:
      (page.description || settings.general.description || '').trim() ||
      undefined,
    type: page.type || 'website',
    image,
    logo,
    datePublished: page.datePublished,
    dateModified: page.dateModified
  })

  // rel=prev / rel=next for paginated archives (#74) — absolutized against the site origin.
  const prev = page.prevPath ? new URL(page.prevPath, base).href : undefined
  const next = page.nextPath ? new URL(page.nextPath, base).href : undefined
  const alternates = buildAlternates(page.alternates, base)

  return { ...seo, jsonLd: jsonLdScript(graph), prev, next, alternates }
}

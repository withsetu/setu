import { resolveSeo, resolveJsonLd, jsonLdScript, type SiteSettings, type ResolvedSeo } from '@setu/core'

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
}

/** Media-resolve a raw path (prepend the media base for root-relative `/media/…`) then absolutize
 *  it against the site origin. Returns undefined for an empty input. */
const absMedia = (raw: string, mediaBase: string, base: URL): string | undefined => {
  if (!raw) return undefined
  const viaMedia = !/^https?:\/\//i.test(raw) && raw.startsWith('/') ? `${mediaBase}${raw}` : raw
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
  page: PageSeoInput = {},
): ResolvedSeo {
  // A prod build sets SETU_SITE_URL (→ Astro.site); the localhost fallback mirrors astro.config.
  const base = site ?? new URL('http://localhost:4321')
  const canonical = new URL(pathname, base).href

  const image = absMedia(page.imagePath || settings.identity.defaultImage || '', mediaBase, base)
  const logo = absMedia(settings.identity.logo || '', mediaBase, base)

  const seo = resolveSeo(settings, {
    title: page.title,
    description: page.description,
    type: page.type,
    locale: page.locale,
    image,
    canonical,
  })

  // JSON-LD @graph (#72) — reuses the resolved absolute URLs; attached as an escaped script string.
  const graph = resolveJsonLd(settings, {
    siteUrl: base.href,
    canonical,
    pageTitle: page.title ?? '',
    description: (page.description || settings.general.description || '').trim() || undefined,
    type: page.type || 'website',
    image,
    logo,
    datePublished: page.datePublished,
    dateModified: page.dateModified,
  })
  return { ...seo, jsonLd: jsonLdScript(graph) }
}

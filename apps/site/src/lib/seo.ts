import { resolveSeo, type SiteSettings, type ResolvedSeo } from '@setu/core'

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

  const rawImage = page.imagePath || settings.identity.defaultImage || ''
  const viaMedia =
    rawImage && !/^https?:\/\//i.test(rawImage) && rawImage.startsWith('/')
      ? `${mediaBase}${rawImage}`
      : rawImage
  const image = viaMedia ? new URL(viaMedia, base).href : undefined

  return resolveSeo(settings, {
    title: page.title,
    description: page.description,
    type: page.type,
    locale: page.locale,
    image,
    canonical,
  })
}

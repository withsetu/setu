import type { SiteSettings } from '../settings/types'
import { GENERATOR_URL } from '../version'

/**
 * Per-page context the head emitters need, beyond site settings. URLs MUST be absolute — this
 * module is pure string assembly; the caller resolves media/site origins (Astro.site, media base).
 */
export interface SeoPage {
  /** Document title (e.g. the post title). Empty/undefined → homepage (site name only). */
  title?: string
  /** Page-level meta description; falls back to the site (general) description. */
  description?: string
  /** og:type — posts are 'article', everything else 'website'. Default 'website'. */
  type?: 'website' | 'article'
  /** Absolute URL of this page's share image; falls back to identity.defaultImage. */
  image?: string
  /** BCP-47 locale for og:locale (e.g. 'en'). Default 'en'. */
  locale?: string
  /** Absolute canonical URL of this page (og:url + <link rel=canonical>). */
  canonical: string
  /** Per-page override: force this page to noindex,nofollow even if the site is search-visible. */
  noindex?: boolean
}

/** A single <meta> tag — exactly one of `name`/`property` is set (Twitter uses name, OG uses property). */
export interface SeoMetaTag {
  name?: string
  property?: string
  content: string
}

export interface ResolvedSeo {
  /** Final <title>, resolved through identity.titleTemplate. */
  title: string
  /** Absolute canonical URL (for <link rel=canonical>). */
  canonical: string
  /** Ordered <meta> tags: description, generator, robots, og:*, twitter:*. */
  meta: SeoMetaTag[]
  /** Escaped JSON-LD string for an inline <script type="application/ld+json"> (#72). Populated by
   *  the app-level orchestration (pageSeo), not resolveSeo itself, which stays tag-only. */
  jsonLd?: string
}

/** Replace {{title}} {{separator}} {{site}} tokens; collapse the whitespace a missing token leaves. */
const fillTemplate = (tpl: string, map: Record<string, string>): string =>
  tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => map[k] ?? '').replace(/\s+/g, ' ').trim()

/**
 * Resolve the full SEO head for a page from site settings + page context — Rank-Math-shaped:
 * title (templated), description, generator, canonical, robots, Open Graph, Twitter cards. Pure.
 *
 * Identity provenance: og:site_name + the {{site}} title token use the SITE title (general.title);
 * identity.name is the JSON-LD *publisher* entity (#72), deliberately not used here.
 */
export function resolveSeo(settings: SiteSettings, page: SeoPage): ResolvedSeo {
  const { identity, general, reading } = settings
  const siteName = general.title || 'Setu'
  const sep = identity.titleSeparator || '·'
  const pageTitle = (page.title ?? '').trim()
  const title = pageTitle
    ? fillTemplate(identity.titleTemplate || '{{title}} {{separator}} {{site}}', {
        title: pageTitle,
        separator: sep,
        site: siteName,
      })
    : siteName

  const description = (page.description || general.description || '').trim()
  const locale = page.locale || 'en'
  const type = page.type || 'website'
  const image = page.image || identity.defaultImage || ''
  const handle = identity.twitterHandle ? `@${identity.twitterHandle.replace(/^@+/, '')}` : ''

  const meta: SeoMetaTag[] = []
  if (description) meta.push({ name: 'description', content: description })
  meta.push({ name: 'generator', content: GENERATOR_URL })
  // A per-page `noindex` override wins; otherwise the site-wide searchEngineVisible setting applies.
  const noindex = page.noindex === true || reading.searchEngineVisible === false
  meta.push({ name: 'robots', content: noindex ? 'noindex, nofollow' : 'index, follow' })

  // Open Graph
  meta.push({ property: 'og:locale', content: locale })
  meta.push({ property: 'og:type', content: type })
  meta.push({ property: 'og:title', content: title })
  if (description) meta.push({ property: 'og:description', content: description })
  meta.push({ property: 'og:url', content: page.canonical })
  meta.push({ property: 'og:site_name', content: siteName })
  if (image) meta.push({ property: 'og:image', content: image })

  // Twitter cards
  meta.push({ name: 'twitter:card', content: image ? 'summary_large_image' : 'summary' })
  if (handle) {
    meta.push({ name: 'twitter:site', content: handle })
    meta.push({ name: 'twitter:creator', content: handle })
  }
  meta.push({ name: 'twitter:title', content: title })
  if (description) meta.push({ name: 'twitter:description', content: description })
  if (image) meta.push({ name: 'twitter:image', content: image })

  return { title, canonical: page.canonical, meta }
}

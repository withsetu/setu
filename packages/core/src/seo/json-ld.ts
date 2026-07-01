import type { SiteSettings } from '../settings/types'

/**
 * Page context for JSON-LD, beyond site settings. All URLs MUST be absolute — the caller resolves
 * site/media origins (this module is pure data assembly).
 */
export interface JsonLdInput {
  /** Absolute site home URL (Astro.site), e.g. `https://example.com/`. */
  siteUrl: string
  /** Absolute canonical URL of this page. */
  canonical: string
  /** Bare page title (headline / WebPage name). Empty → homepage (site name). */
  pageTitle: string
  /** Page description; already fallen back to the site description by the caller. */
  description?: string
  /** `article` for posts (adds an Article node), else `website`. */
  type: 'website' | 'article'
  /** Absolute primary image URL. */
  image?: string
  /** Absolute logo URL (Organization logo). */
  logo?: string
  /** ISO 8601 publish date (Article/WebPage). */
  datePublished?: string
  /** ISO 8601 modified date (Article/WebPage). */
  dateModified?: string
}

export interface JsonLdGraph {
  '@context': 'https://schema.org'
  '@graph': Record<string, unknown>[]
}

type Node = Record<string, unknown>

/**
 * Build the schema.org `@graph` for a page from identity settings + page context — Rank-Math-shaped:
 * a publisher (Person|Organization), the WebSite, the WebPage, a primary ImageObject, and an Article
 * node for posts. Nodes cross-reference by `@id` so the graph stays a single connected document. Pure.
 */
export function resolveJsonLd(settings: SiteSettings, input: JsonLdInput): JsonLdGraph {
  const { identity, general } = settings
  const siteName = general.title || 'Setu'
  const isOrg = identity.entityType !== 'person'
  const entityId = `${input.siteUrl}#${isOrg ? 'organization' : 'person'}`
  const websiteId = `${input.siteUrl}#website`
  const webpageId = `${input.canonical}#webpage`
  const imageId = `${input.canonical}#primaryimage`
  const logoId = `${input.siteUrl}#logo`
  const isArticle = input.type === 'article'

  const graph: Node[] = []

  // Publisher — Person or Organization
  const publisher: Node = {
    '@type': isOrg ? 'Organization' : 'Person',
    '@id': entityId,
    name: identity.name || siteName,
    url: identity.url || input.siteUrl,
  }
  if (isOrg && input.logo) {
    publisher.logo = { '@type': 'ImageObject', '@id': logoId, url: input.logo }
    publisher.image = { '@id': logoId }
  }
  if (identity.socialProfiles.length) publisher.sameAs = identity.socialProfiles
  graph.push(publisher)

  // WebSite
  const website: Node = {
    '@type': 'WebSite',
    '@id': websiteId,
    url: input.siteUrl,
    name: siteName,
    publisher: { '@id': entityId },
  }
  if (general.description) website.description = general.description
  graph.push(website)

  // Primary image (shared @id, referenced by WebPage + Article)
  if (input.image) graph.push({ '@type': 'ImageObject', '@id': imageId, url: input.image })

  // WebPage
  const webpage: Node = {
    '@type': 'WebPage',
    '@id': webpageId,
    url: input.canonical,
    name: input.pageTitle || siteName,
    isPartOf: { '@id': websiteId },
  }
  if (input.description) webpage.description = input.description
  if (input.image) webpage.primaryImageOfPage = { '@id': imageId }
  if (input.datePublished) webpage.datePublished = input.datePublished
  if (input.dateModified) webpage.dateModified = input.dateModified
  graph.push(webpage)

  // Article (posts only)
  if (isArticle) {
    const article: Node = {
      '@type': 'Article',
      '@id': `${input.canonical}#article`,
      headline: input.pageTitle,
      isPartOf: { '@id': webpageId },
      mainEntityOfPage: { '@id': webpageId },
      author: { '@id': entityId },
      publisher: { '@id': entityId },
    }
    if (input.datePublished) article.datePublished = input.datePublished
    if (input.dateModified) article.dateModified = input.dateModified
    if (input.image) article.image = { '@id': imageId }
    if (input.description) article.description = input.description
    graph.push(article)
  }

  return { '@context': 'https://schema.org', '@graph': graph }
}

/** Serialize a graph for an inline `<script type="application/ld+json">`, escaping `<` so a value
 *  containing `</script>` can't break out of the tag. */
export function jsonLdScript(graph: JsonLdGraph): string {
  return JSON.stringify(graph).replace(/</g, '\\u003c')
}

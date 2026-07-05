import type { PermalinksSettings } from '../permalinks/config'
export type { PermalinksSettings }

/** The General settings group. title/tagline/description are consumed by the
 *  site; timezone/dateFormat are stored now and consumed when date display lands. */
export interface GeneralSettings {
  title: string
  tagline: string
  description: string
  timezone: string
  dateFormat: string
}

export interface ReadingSettings {
  /** Entry id served at '/', e.g. 'page/en/home'. */
  homepage: string
  /** false → emit a noindex robots meta. */
  searchEngineVisible: boolean
  /** Admin content-list page size. */
  listPageSize: number
  /** Front-end post-archive (/posts) page size. */
  postsPerPage: number
  /** RSS feed config — consumed by a later increment. */
  feed: { enabled: boolean; items: number }
  /** Markdown / llms.txt output — consumed by a later increment. */
  markdown: { mode: 'off' | 'index' | 'pages'; style: 'raw' | 'rendered' }
  /** Auto-appended related-posts widget configuration. */
  relatedPosts: {
    enabled: boolean
    heading: string
    count: number
    showImage: boolean
  }
  /** Sitemap section toggles — which content types + taxonomies the sitemap index includes. */
  sitemap: {
    posts: boolean
    pages: boolean
    categories: boolean
    tags: boolean
  }
}

/** The Media settings group — drives the image pipeline (variant formats + LQIP). */
export interface MediaSettings {
  imageFormat: 'webp' | 'avif' | 'both'
  imageLqip: boolean
}

/** Identity / SEO settings — the source of truth for the SEO head emitters (#71),
 *  JSON-LD structured data (#72), and the RSS <image>/<dc:creator> follow-ups. Stored
 *  in settings.json; consumed downstream. Empty fields fall back at emit time (e.g.
 *  `name` → general.title), so a blank group is valid. */
export interface IdentitySettings {
  /** schema.org publisher type — drives the JSON-LD entity (Person vs Organization). */
  entityType: 'person' | 'organization'
  /** Publisher display name (JSON-LD name; falls back to the site title when empty). */
  name: string
  /** Canonical URL of the person/organization (JSON-LD url; anchors sameAs). */
  url: string
  /** Site logo media src — JSON-LD logo + RSS channel <image>. */
  logo: string
  /** Default Open Graph / Twitter share image (media src) for pages without their own. */
  defaultImage: string
  /** Social profile URLs (schema.org sameAs). */
  socialProfiles: string[]
  /** Twitter/X handle, stored without the leading '@' (twitter:site / twitter:creator). */
  twitterHandle: string
  /** Document <title> template. Tokens: {{title}} {{separator}} {{site}}. */
  titleTemplate: string
  /** Separator used by titleTemplate (and other title fallbacks), e.g. '·', '-', '|'. */
  titleSeparator: string
}

/** Site settings, grouped so future sections (identity/content/media/forms) add
 *  cleanly. Persisted as a Git-backed settings.json. Never holds secrets. */
export interface SiteSettings {
  general: GeneralSettings
  reading: ReadingSettings
  media: MediaSettings
  identity: IdentitySettings
  permalinks: PermalinksSettings
}

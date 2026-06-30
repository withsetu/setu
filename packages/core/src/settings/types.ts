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
  relatedPosts: { enabled: boolean; heading: string; count: number; showImage: boolean }
}

/** Site settings, grouped so future sections (identity/content/media/forms) add
 *  cleanly. Persisted as a Git-backed settings.json. Never holds secrets. */
export interface SiteSettings {
  general: GeneralSettings
  reading: ReadingSettings
}

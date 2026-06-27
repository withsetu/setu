import type { SiteSettings } from './types'

export const DEFAULT_SETTINGS: SiteSettings = {
  general: {
    title: 'Setu',
    tagline: '',
    description: '',
    timezone: 'UTC',
    dateFormat: 'MMM D, YYYY',
  },
  reading: {
    homepage: 'page/en/home',
    searchEngineVisible: true,
    listPageSize: 25,
    feed: { enabled: false, items: 20 },
    markdown: { mode: 'off', style: 'raw' },
    relatedPosts: { enabled: true, heading: 'Read Next', count: 3, showImage: true },
  },
}

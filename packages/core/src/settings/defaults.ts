import type { SiteSettings } from './types'

export const DEFAULT_SETTINGS: SiteSettings = {
  general: {
    title: 'Setu',
    tagline: '',
    description: '',
    timezone: 'UTC',
    dateFormat: 'MMM D, YYYY'
  },
  reading: {
    homepage: 'page/en/home',
    searchEngineVisible: true,
    listPageSize: 25,
    postsPerPage: 6,
    feed: { enabled: false, items: 20 },
    markdown: { mode: 'off', style: 'raw' },
    relatedPosts: {
      enabled: true,
      heading: 'Read Next',
      count: 3,
      showImage: true
    },
    sitemap: { posts: true, pages: true, categories: true, tags: true }
  },
  media: { imageFormat: 'webp', imageLqip: false },
  identity: {
    entityType: 'organization',
    name: '',
    url: '',
    logo: '',
    defaultImage: '',
    socialProfiles: [],
    twitterHandle: '',
    titleTemplate: '{{title}} {{separator}} {{site}}',
    titleSeparator: '·'
  },
  permalinks: { patterns: {}, uncategorized: 'uncategorized' }
}

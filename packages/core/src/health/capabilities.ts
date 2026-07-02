import type { SiteCapabilities } from './types'

/** What the default theme + site pipeline emit TODAY. Kept honest by the render test in
 *  apps/site/test/capabilities.test.ts. Emitter increments flip a flag (and the test enforces it). */
export const SITE_CAPABILITIES: SiteCapabilities = {
  doctype: true, langAttr: true, charset: true, viewport: true,
  title: true, metaDescription: true,
  canonical: true, favicon: false, openGraph: true, twitterCard: true, themeColor: false,
  rssAutodiscovery: false,
  sitemap: true, robotsTxt: true, jsonLd: true,
  llmsTxt: false, perPageMarkdown: false,
  hreflang: false, customError: false, skipLink: false, focusStyles: false,
}

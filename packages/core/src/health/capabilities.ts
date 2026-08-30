import type { SiteCapabilities } from './types'

/** What the default theme + site pipeline emit TODAY. Kept honest by the render test in
 *  apps/site/test/capabilities.test.ts. Emitter increments flip a flag (and the test enforces it). */
export const SITE_CAPABILITIES: SiteCapabilities = {
  doctype: true,
  langAttr: true,
  charset: true,
  viewport: true,
  title: true,
  metaDescription: true,
  canonical: true,
  favicon: false,
  openGraph: true,
  twitterCard: true,
  themeColor: false,
  rssAutodiscovery: false,
  sitemap: true,
  sitemapIndex: true,
  imageSitemaps: true,
  robotsTxt: true,
  jsonLd: true,
  llmsTxt: false,
  perPageMarkdown: false,
  hreflang: true,
  customError: false,
  skipLink: false,
  focusStyles: false,
  // #375: both already shipped by packages/image-astro/src/Image.astro, but nothing evaluated
  // them, so the scorecard under-reported. Asserted against the REAL build output in
  // apps/site/test/capabilities.test.ts — a flag that drifts from what the site emits fails there.
  imageOptimization: true,
  lazyLoading: true
}

import type { RubricItem } from './types'

const URL = 'https://specification.website/checklist/' // per-item deep links refined via the MCP sync later

export const RUBRIC: RubricItem[] = [
  // Foundations
  { id: 'foundations.doctype', category: 'foundations', severity: 'required', title: 'HTML doctype', guidance: 'Pages declare <!DOCTYPE html>.', url: URL },
  { id: 'foundations.lang', category: 'foundations', severity: 'required', title: 'Document language', guidance: 'The <html> element sets a lang attribute.', url: URL },
  { id: 'foundations.charset', category: 'foundations', severity: 'required', title: 'Character encoding', guidance: 'A <meta charset> is declared early in <head>.', url: URL },
  { id: 'foundations.viewport', category: 'foundations', severity: 'required', title: 'Viewport meta', guidance: 'A responsive viewport meta tag is present.', url: URL },
  { id: 'foundations.title', category: 'foundations', severity: 'required', title: 'Site title', guidance: 'A site title is set and used in page titles.', url: URL },
  { id: 'foundations.entry-title', category: 'foundations', severity: 'required', title: 'Entry titles', guidance: 'Every content entry has a non-empty title.', url: URL },
  { id: 'foundations.description', category: 'foundations', severity: 'recommended', title: 'Meta description', guidance: 'A site description is set for search/social snippets.', url: URL },
  { id: 'foundations.canonical', category: 'foundations', severity: 'required', title: 'Canonical URL', guidance: 'Each page declares a canonical link to avoid duplicate-content issues.', url: URL },
  { id: 'foundations.favicon', category: 'foundations', severity: 'recommended', title: 'Favicon', guidance: 'A favicon/site icon is linked.', url: URL },
  { id: 'foundations.open-graph', category: 'foundations', severity: 'recommended', title: 'Open Graph tags', guidance: 'og: tags improve link previews when shared.', url: URL },
  { id: 'foundations.twitter-card', category: 'foundations', severity: 'optional', title: 'Twitter Card tags', guidance: 'twitter: tags refine previews on X/Twitter.', url: URL },
  { id: 'foundations.theme-color', category: 'foundations', severity: 'optional', title: 'Theme color', guidance: 'A theme-color meta tints mobile browser UI.', url: URL },
  { id: 'foundations.feed', category: 'foundations', severity: 'optional', title: 'Web feed', guidance: 'An RSS/Atom feed is offered and auto-discoverable.', url: URL },
  // SEO
  { id: 'seo.homepage', category: 'seo', severity: 'required', title: 'Homepage set', guidance: 'A homepage is configured and resolves to an existing page.', url: URL },
  { id: 'seo.indexable', category: 'seo', severity: 'required', title: 'Search engines allowed', guidance: 'The site is not accidentally set to noindex.', url: URL },
  { id: 'seo.canonical-route', category: 'seo', severity: 'recommended', title: 'Clean URL structure', guidance: 'URLs are stable, lowercase, and human-readable.', url: URL },
  { id: 'seo.single-h1', category: 'seo', severity: 'recommended', title: 'One H1 per page', guidance: 'Each page has a single top-level heading.', url: URL },
  { id: 'seo.sitemap', category: 'seo', severity: 'required', title: 'XML sitemap', guidance: 'A sitemap.xml lists the sites URLs for crawlers.', url: URL },
  { id: 'seo.robots-txt', category: 'seo', severity: 'recommended', title: 'robots.txt', guidance: 'A robots.txt advertises crawl rules and the sitemap.', url: URL },
  { id: 'seo.json-ld', category: 'seo', severity: 'recommended', title: 'Structured data', guidance: 'JSON-LD describes pages to search engines.', url: URL },
  // Accessibility
  { id: 'accessibility.image-alt', category: 'accessibility', severity: 'recommended', title: 'Image alt text', guidance: 'Content images have descriptive alt text.', url: URL },
  { id: 'accessibility.skip-link', category: 'accessibility', severity: 'recommended', title: 'Skip to content', guidance: 'A skip link lets keyboard users jump to main content.', url: URL },
  { id: 'accessibility.focus-styles', category: 'accessibility', severity: 'recommended', title: 'Visible focus', guidance: 'Interactive elements show a visible focus indicator.', url: URL },
  // Agent readiness
  { id: 'agent-readiness.llms-txt', category: 'agent-readiness', severity: 'recommended', title: 'llms.txt', guidance: 'An llms.txt helps AI agents discover your content.', url: URL },
  { id: 'agent-readiness.markdown', category: 'agent-readiness', severity: 'optional', title: 'Markdown endpoints', guidance: 'Pages are available as clean markdown for agents.', url: URL },
  // i18n
  { id: 'i18n.hreflang', category: 'i18n', severity: 'recommended', title: 'hreflang alternates', guidance: 'Translated pages link to each other via hreflang.', url: URL },
  // Resilience
  { id: 'resilience.custom-404', category: 'resilience', severity: 'recommended', title: 'Custom 404 page', guidance: 'A branded 404 page handles missing URLs.', url: URL },
  // Security (live probe — v2)
  { id: 'security.https', category: 'security', severity: 'required', title: 'HTTPS', guidance: 'The site is served over HTTPS.', url: URL, liveProbe: true },
  { id: 'security.hsts', category: 'security', severity: 'recommended', title: 'HSTS header', guidance: 'Strict-Transport-Security enforces HTTPS.', url: URL, liveProbe: true },
  { id: 'security.csp', category: 'security', severity: 'recommended', title: 'Content Security Policy', guidance: 'A CSP limits where resources can load from.', url: URL, liveProbe: true },
  { id: 'security.content-type-options', category: 'security', severity: 'recommended', title: 'X-Content-Type-Options', guidance: 'nosniff prevents MIME-type sniffing.', url: URL, liveProbe: true },
  // Performance (live probe — v2)
  { id: 'performance.core-web-vitals', category: 'performance', severity: 'required', title: 'Core Web Vitals', guidance: 'LCP, INP, and CLS are within healthy thresholds.', url: URL, liveProbe: true },
  // Privacy / well-known (manual)
  { id: 'privacy.policy', category: 'privacy', severity: 'recommended', title: 'Privacy policy', guidance: 'A privacy policy explains data handling.', url: URL },
  { id: 'well-known.security-txt', category: 'well-known', severity: 'optional', title: 'security.txt', guidance: 'A /.well-known/security.txt lists a security contact.', url: URL },
]

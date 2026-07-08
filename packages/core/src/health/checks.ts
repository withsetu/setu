import type {
  AuditContext,
  CheckResult,
  Owner,
  SiteCapabilities
} from './types'
import { scanBody } from './scan'
import { SITE_CAPABILITIES } from './capabilities'

type Evaluator = (ctx: AuditContext) => Omit<CheckResult, 'id'>

const ok = (owner: Owner, detail?: string): Omit<CheckResult, 'id'> => ({
  status: 'pass',
  owner,
  detail
})
const bad = (
  owner: Owner,
  detail?: string,
  offenders?: CheckResult['offenders']
): Omit<CheckResult, 'id'> => ({ status: 'fail', owner, detail, offenders })

const nonEmpty = (v: unknown): boolean =>
  typeof v === 'string' && v.trim() !== ''

const cap =
  (key: keyof SiteCapabilities): Evaluator =>
  (ctx) =>
    ctx.capabilities[key]
      ? ok('platform')
      : bad('platform', 'Not emitted by Setu yet — on the roadmap.')

export const EVALUATORS: Record<string, Evaluator> = {
  // config
  'foundations.title': (ctx) =>
    nonEmpty(ctx.settings.general.title)
      ? ok('config')
      : bad('config', 'Set a site title in Settings → General.'),
  'foundations.description': (ctx) =>
    nonEmpty(ctx.settings.general.description)
      ? ok('config')
      : bad('config', 'Set a site description in Settings → General.'),
  'seo.homepage': (ctx) =>
    ctx.entries.some((e) => e.id === ctx.settings.reading.homepage)
      ? ok('config')
      : bad(
          'config',
          'The configured homepage does not resolve to an existing page.'
        ),
  'seo.indexable': (ctx) =>
    ctx.settings.reading.searchEngineVisible
      ? ok('config')
      : bad(
          'config',
          'Search engines are discouraged (noindex). Turn this off in Settings → Content & Reading when ready to launch.'
        ),
  'foundations.feed': (ctx) =>
    ctx.settings.reading.feed.enabled
      ? ok('config')
      : bad('config', 'Enable the RSS feed in Settings → Content & Reading.'),
  // content (aggregate over entries; list offenders)
  'foundations.entry-title': (ctx) => {
    const off = ctx.entries
      .filter((e) => !nonEmpty(e.data.title))
      .map((e) => ({ ref: e.id, note: 'missing title' }))
    return off.length
      ? bad(
          'content',
          `${off.length} entr${off.length === 1 ? 'y' : 'ies'} missing a title`,
          off
        )
      : ok('content')
  },
  'accessibility.image-alt': (ctx) => {
    const off = ctx.entries
      .map((e) => ({ e, n: scanBody(e.body).imagesWithoutAlt }))
      .filter((x) => x.n > 0)
      .map((x) => ({ ref: x.e.id, note: `${x.n} image(s) without alt text` }))
    return off.length
      ? bad(
          'content',
          `${off.length} entr${off.length === 1 ? 'y' : 'ies'} with images missing alt text`,
          off
        )
      : ok('content')
  },
  'seo.single-h1': (ctx) => {
    // The template emits the title as the page H1; any H1 in the body is a second one.
    const off = ctx.entries
      .filter((e) => scanBody(e.body).h1Count > 0)
      .map((e) => ({ ref: e.id, note: 'extra H1 in body' }))
    return off.length
      ? bad(
          'content',
          `${off.length} entr${off.length === 1 ? 'y' : 'ies'} with an extra H1`,
          off
        )
      : ok('content')
  },
  'seo.canonical-route': () =>
    ok('platform', 'URLs follow the clean collection/slug convention.'),
  // platform capabilities
  'foundations.doctype': cap('doctype'),
  'foundations.lang': cap('langAttr'),
  'foundations.charset': cap('charset'),
  'foundations.viewport': cap('viewport'),
  'foundations.canonical': cap('canonical'),
  'foundations.favicon': cap('favicon'),
  'foundations.open-graph': cap('openGraph'),
  'foundations.twitter-card': cap('twitterCard'),
  'foundations.theme-color': cap('themeColor'),
  'seo.sitemap': cap('sitemap'),
  'seo.sitemap-index': cap('sitemapIndex'),
  // The rubric row covers image AND video extensions — Setu emits both: <image:image> for page
  // media and <video:video> for video embeds (#367).
  'seo.image-sitemaps': (ctx) =>
    ctx.capabilities.imageSitemaps
      ? ok(
          'platform',
          'Image (<image:image>) and video (<video:video>) sitemap extensions are emitted.'
        )
      : bad('platform', 'Not emitted by Setu yet — on the roadmap.'),
  'seo.robots-txt': cap('robotsTxt'),
  'seo.json-ld': cap('jsonLd'),
  'agent-readiness.llms-txt': cap('llmsTxt'),
  'agent-readiness.markdown': cap('perPageMarkdown'),
  'i18n.hreflang': cap('hreflang'),
  'resilience.custom-404': cap('customError'),
  'accessibility.skip-link': cap('skipLink'),
  'accessibility.focus-styles': cap('focusStyles')
}

// `foundations.feed` reflects a capability AND a config toggle; the config evaluator above is
// the source of truth for v1 (the autodiscovery capability flips when #51 merges). Keep one.
void SITE_CAPABILITIES

/** Locale = the 2nd id segment (collection/LOCALE/slug). */
function localeCount(ctx: AuditContext): number {
  return new Set(ctx.entries.map((e) => e.id.split('/')[1]).filter(Boolean))
    .size
}

/** Auto-applicability predicates, keyed by item id OR category. False → the item is N/A (auto). */
export const APPLIES_WHEN: Record<string, (ctx: AuditContext) => boolean> = {
  // Internationalisation only matters once the site has more than one content locale.
  i18n: (ctx) => localeCount(ctx) > 1
}

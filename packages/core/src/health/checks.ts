import type {
  AuditContext,
  CheckResult,
  Owner,
  SiteCapabilities
} from './types'
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

/** A SCAN-class check with no scan yet: score-neutral `pending`, prompting a run. */
const needsScan = (owner: Owner): Omit<CheckResult, 'id'> => ({
  status: 'pending',
  owner,
  detail: 'Run a site scan to check this.'
})

const plural = (n: number): string =>
  `${n} entr${n === 1 ? 'y' : 'ies'}`

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
  'seo.homepage': (ctx) => {
    if (ctx.scan === null) return needsScan('config')
    return ctx.scan.entryIds.includes(ctx.settings.reading.homepage)
      ? ok('config')
      : bad(
          'config',
          'The configured homepage does not resolve to an existing page.'
        )
  },
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
  // content (SCAN class — reads the index-backed content facts; list offenders)
  'foundations.entry-title': (ctx) => {
    if (ctx.scan === null) return needsScan('content')
    const off = ctx.scan.titleOffenders.map((ref) => ({
      ref,
      note: 'missing title'
    }))
    return off.length
      ? bad('content', `${plural(off.length)} missing a title`, off)
      : ok('content')
  },
  'accessibility.image-alt': (ctx) => {
    if (ctx.scan === null) return needsScan('content')
    const off = ctx.scan.altOffenders.map((o) => ({
      ref: o.ref,
      note: `${o.count} image(s) without alt text`
    }))
    return off.length
      ? bad(
          'content',
          `${plural(off.length)} with images missing alt text`,
          off
        )
      : ok('content')
  },
  'seo.single-h1': (ctx) => {
    if (ctx.scan === null) return needsScan('content')
    // The template emits the title as the page H1; any H1 in the body is a second one.
    const off = ctx.scan.h1Offenders.map((ref) => ({
      ref,
      note: 'extra H1 in body'
    }))
    return off.length
      ? bad('content', `${plural(off.length)} with an extra H1`, off)
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

/** Auto-applicability predicates, keyed by item id OR category. False → the item is N/A (auto). */
export const APPLIES_WHEN: Record<string, (ctx: AuditContext) => boolean> = {
  // Internationalisation only matters once the site has more than one content locale —
  // a scan-derived fact (#593). Until a scan has run (`scan === null`) the locale count
  // is unknown, so i18n stays applicable rather than being silently auto-N/A'd.
  i18n: (ctx) => ctx.scan === null || ctx.scan.locales.length > 1
}

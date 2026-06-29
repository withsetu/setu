# Site Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Site Health scorecard in the admin that audits the site against a vendored specification.website rubric and shows what's right, what to improve, and what Setu doesn't emit yet — with a dashboard score and a `/health` breakdown.

**Architecture:** A vendored rubric + a capability map + pure per-item evaluators + a pure `runAudit(context)` in `@setu/core` (unit-tested). The admin builds the context (settings + committed content + capability map), runs the audit in-memory, and renders a dashboard `<SiteHealthCard/>` + a `/health` screen. No runtime phone-home; live-probe items (headers/CWV) appear as `pending` for a v2 increment.

**Tech Stack:** TypeScript (strict), `@markdoc/markdoc` (AST scan), React 19 + shadcn/ui, Vitest, the existing `GitPort`/settings-store/content helpers.

## Global Constraints

- TS strict, `verbatimModuleSyntax` (`import type` for types), `isolatedModules`.
- **No runtime external calls** — rubric is vendored data; checks are pure. The specification.website MCP is a maintainer-time sync only.
- **Guidance text must be original short paraphrases** (do not copy specification.website prose verbatim — license unverified); each item links out to `https://specification.website/checklist/` and the UI credits the source.
- **Scoring:** severity weights `required=10, avoid=10, recommended=3, optional=1`. **Denominator = pass+fail (auto-verifiable) results only**; `manual`/`pending` excluded. `score = round(Σweight(pass) / Σweight(pass+fail) × 100)` (or 100 if denominator 0). Bands: ≥90 green "Strong", 70–89 amber "Good", <70 red "Needs work".
- **Owner tags:** `config` | `content` | `platform` | `manual`. `pending` status = live-probe item (v2), not scored.
- **Capabilities = the product-gap radar.** Initial truth: `doctype/langAttr/charset/viewport/title/metaDescription = true`; everything else `false`. A render test keeps the map honest.
- Admin UI is shadcn-first (CLAUDE.md). Commit author `OWNER_AUTHOR` for any git writes (none expected here). TDD; conventional commits ending `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: Core — rubric data, capability map, types

**Files:**
- Create: `packages/core/src/health/types.ts`, `packages/core/src/health/capabilities.ts`, `packages/core/src/health/rubric.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/health-rubric.test.ts`

**Interfaces:**
- Produces: types `Severity`, `Category`, `Owner`, `CheckStatus`, `RubricItem`, `SiteCapabilities`, `CheckResult`, `AuditContext`, `AuditResult`, `CategoryScore`; data `RUBRIC: RubricItem[]`, `SITE_CAPABILITIES: SiteCapabilities`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/health-rubric.test.ts
import { describe, it, expect } from 'vitest'
import { RUBRIC, SITE_CAPABILITIES } from '../src/index'

describe('health rubric', () => {
  it('has unique ids and valid severities/categories', () => {
    const ids = RUBRIC.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    const sev = new Set(['required', 'recommended', 'optional', 'avoid'])
    const cat = new Set(['foundations','seo','accessibility','security','well-known','agent-readiness','performance','privacy','resilience','i18n'])
    for (const r of RUBRIC) {
      expect(sev.has(r.severity)).toBe(true)
      expect(cat.has(r.category)).toBe(true)
      expect(r.title.length).toBeGreaterThan(0)
      expect(r.guidance.length).toBeGreaterThan(0)
      expect(r.url.startsWith('https://specification.website')).toBe(true)
    }
  })
  it('starts with the emitted-today capabilities true and the rest false', () => {
    expect(SITE_CAPABILITIES.title).toBe(true)
    expect(SITE_CAPABILITIES.viewport).toBe(true)
    expect(SITE_CAPABILITIES.canonical).toBe(false)
    expect(SITE_CAPABILITIES.sitemap).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- health-rubric`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `packages/core/src/health/types.ts`**

```ts
export type Severity = 'required' | 'recommended' | 'optional' | 'avoid'
export type Category =
  | 'foundations' | 'seo' | 'accessibility' | 'security' | 'well-known'
  | 'agent-readiness' | 'performance' | 'privacy' | 'resilience' | 'i18n'
export type Owner = 'config' | 'content' | 'platform' | 'manual'
export type CheckStatus = 'pass' | 'fail' | 'manual' | 'pending'

export interface RubricItem {
  id: string
  category: Category
  severity: Severity
  title: string
  guidance: string
  url: string
  /** Items needing a live-site probe (security headers, CWV) — show as `pending` in v1. */
  liveProbe?: boolean
}

export interface SiteCapabilities {
  doctype: boolean; langAttr: boolean; charset: boolean; viewport: boolean
  title: boolean; metaDescription: boolean; canonical: boolean; favicon: boolean
  openGraph: boolean; twitterCard: boolean; themeColor: boolean; rssAutodiscovery: boolean
  sitemap: boolean; robotsTxt: boolean; jsonLd: boolean
  llmsTxt: boolean; perPageMarkdown: boolean
  hreflang: boolean; customError: boolean; skipLink: boolean; focusStyles: boolean
}

export interface AuditEntry {
  id: string                       // collection/locale/slug
  data: Record<string, unknown>    // frontmatter
  body: string                     // raw markdoc body
}

export interface AuditContext {
  settings: { general: { title: string; description: string }; reading: { homepage: string; searchEngineVisible: boolean; feed: { enabled: boolean } } }
  entries: AuditEntry[]
  capabilities: SiteCapabilities
}

export interface CheckResult {
  id: string
  status: CheckStatus
  owner: Owner
  detail?: string
  offenders?: { ref: string; note: string }[]
}

export interface CategoryScore { category: Category; score: number; pass: number; total: number }

export interface AuditResult {
  results: CheckResult[]
  score: number
  band: 'strong' | 'good' | 'needs-work'
  byCategory: CategoryScore[]
  mustHaves: { done: number; total: number }
}
```

- [ ] **Step 4: Create `packages/core/src/health/capabilities.ts`**

```ts
import type { SiteCapabilities } from './types'

/** What the default theme + site pipeline emit TODAY. Kept honest by the render test in
 *  apps/site/test/capabilities.test.ts. Emitter increments flip a flag (and the test enforces it). */
export const SITE_CAPABILITIES: SiteCapabilities = {
  doctype: true, langAttr: true, charset: true, viewport: true,
  title: true, metaDescription: true,
  canonical: false, favicon: false, openGraph: false, twitterCard: false, themeColor: false,
  rssAutodiscovery: false,
  sitemap: false, robotsTxt: false, jsonLd: false,
  llmsTxt: false, perPageMarkdown: false,
  hreflang: false, customError: false, skipLink: false, focusStyles: false,
}
```

- [ ] **Step 5: Create `packages/core/src/health/rubric.ts`**

```ts
import type { RubricItem } from './types'

const URL = 'https://specification.website/checklist/' // per-item deep links refined via the MCP sync later

export const RUBRIC: RubricItem[] = [
  // Foundations
  { id: 'foundations.doctype', category: 'foundations', severity: 'required', title: 'HTML doctype', guidance: 'Pages declare <!DOCTYPE html>.', url: URL },
  { id: 'foundations.lang', category: 'foundations', severity: 'required', title: 'Document language', guidance: 'The <html> element sets a lang attribute.', url: URL },
  { id: 'foundations.charset', category: 'foundations', severity: 'required', title: 'Character encoding', guidance: 'A <meta charset> is declared early in <head>.', url: URL },
  { id: 'foundations.viewport', category: 'foundations', severity: 'required', title: 'Viewport meta', guidance: 'A responsive viewport meta tag is present.', url: URL },
  { id: 'foundations.title', category: 'foundations', severity: 'required', title: 'Site title', guidance: 'A site title is set and used in page titles.', url: URL },
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
  { id: 'seo.sitemap', category: 'seo', severity: 'required', title: 'XML sitemap', guidance: 'A sitemap.xml lists the site’s URLs for crawlers.', url: URL },
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
```

- [ ] **Step 6: Export from `packages/core/src/index.ts`**

Add (following the existing per-submodule export pattern):
```ts
export type {
  Severity, Category, Owner, CheckStatus, RubricItem, SiteCapabilities,
  AuditEntry, AuditContext, CheckResult, CategoryScore, AuditResult,
} from './health/types'
export { RUBRIC } from './health/rubric'
export { SITE_CAPABILITIES } from './health/capabilities'
```

- [ ] **Step 7: Run test + commit**

Run: `pnpm --filter @setu/core test -- health-rubric` → PASS. Then `pnpm --filter @setu/core typecheck`.
```bash
git add packages/core/src/health/types.ts packages/core/src/health/capabilities.ts packages/core/src/health/rubric.ts packages/core/src/index.ts packages/core/test/health-rubric.test.ts
git commit -m "feat(core): site-health rubric + capability map + types"
```

---

## Task 2: Core — evaluators + `runAudit`

**Files:**
- Create: `packages/core/src/health/scan.ts`, `packages/core/src/health/checks.ts`, `packages/core/src/health/run-audit.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/health-audit.test.ts`

**Interfaces:**
- Consumes: `RUBRIC`, `SITE_CAPABILITIES`, types (Task 1).
- Produces: `scanBody(body): { imagesWithoutAlt: number; h1Count: number }`; `runAudit(context: AuditContext): AuditResult`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/health-audit.test.ts
import { describe, it, expect } from 'vitest'
import { runAudit, scanBody, SITE_CAPABILITIES } from '../src/index'
import type { AuditContext } from '../src/index'

const ctx = (over: Partial<AuditContext> = {}): AuditContext => ({
  settings: { general: { title: 'T', description: 'D' }, reading: { homepage: 'page/en/home', searchEngineVisible: true, feed: { enabled: false } } },
  entries: [{ id: 'page/en/home', data: { title: 'Home' }, body: 'Hello' }],
  capabilities: SITE_CAPABILITIES,
  ...over,
})

describe('scanBody', () => {
  it('flags images without alt and counts h1s', () => {
    const r = scanBody('# Heading\n\n![](pic.png)\n\n{% image src="x.png" %}{% /image %}')
    expect(r.imagesWithoutAlt).toBe(2)
    expect(r.h1Count).toBe(1)
  })
  it('does not flag images with alt', () => {
    expect(scanBody('![a cat](cat.png)').imagesWithoutAlt).toBe(0)
  })
})

describe('runAudit', () => {
  it('passes config checks when settings are complete', () => {
    const a = runAudit(ctx())
    expect(a.results.find((r) => r.id === 'foundations.title')?.status).toBe('pass')
    expect(a.results.find((r) => r.id === 'seo.indexable')?.status).toBe('pass')
  })
  it('fails seo.indexable when noindex is set', () => {
    const a = runAudit(ctx({ settings: { general: { title: 'T', description: 'D' }, reading: { homepage: 'page/en/home', searchEngineVisible: false, feed: { enabled: false } } } }))
    expect(a.results.find((r) => r.id === 'seo.indexable')?.status).toBe('fail')
  })
  it('fails image-alt with offenders', () => {
    const a = runAudit(ctx({ entries: [{ id: 'post/en/p', data: { title: 'P' }, body: '![](x.png)' }] }))
    const r = a.results.find((x) => x.id === 'accessibility.image-alt')!
    expect(r.status).toBe('fail')
    expect(r.offenders?.[0]?.ref).toBe('post/en/p')
  })
  it('marks platform gaps as fail and live items as pending', () => {
    const a = runAudit(ctx())
    expect(a.results.find((r) => r.id === 'seo.canonical')?.status).toBe('fail')
    expect(a.results.find((r) => r.id === 'seo.canonical')?.owner).toBe('platform')
    expect(a.results.find((r) => r.id === 'security.hsts')?.status).toBe('pending')
    expect(a.results.find((r) => r.id === 'privacy.policy')?.status).toBe('manual')
  })
  it('scores only pass+fail, surfaces must-haves, assigns a band', () => {
    const a = runAudit(ctx())
    expect(a.score).toBeGreaterThanOrEqual(0)
    expect(a.score).toBeLessThanOrEqual(100)
    expect(['strong', 'good', 'needs-work']).toContain(a.band)
    expect(a.mustHaves.total).toBeGreaterThan(0)
    // pending/manual excluded: a perfect config+content+caps run never reaches 100 here because platform gaps fail,
    // but security.hsts (pending) must NOT count against it
    expect(a.results.some((r) => r.status === 'pending')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- health-audit`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `packages/core/src/health/scan.ts`**

```ts
import Markdoc from '@markdoc/markdoc'

interface AstNode { type?: string; tag?: string; attributes?: Record<string, unknown>; children?: AstNode[] }

/** Scan a raw markdoc body for images missing alt text and the number of H1 headings. */
export function scanBody(body: string): { imagesWithoutAlt: number; h1Count: number } {
  let imagesWithoutAlt = 0
  let h1Count = 0
  const root = Markdoc.parse(body) as unknown as AstNode
  const walk = (node: AstNode | undefined): void => {
    if (!node) return
    const isMdImage = node.type === 'image'
    const isTagImage = node.type === 'tag' && node.tag === 'image'
    if (isMdImage || isTagImage) {
      const alt = node.attributes?.alt
      if (typeof alt !== 'string' || alt.trim() === '') imagesWithoutAlt++
    }
    if (node.type === 'heading' && node.attributes?.level === 1) h1Count++
    for (const c of node.children ?? []) walk(c)
  }
  walk(root)
  return { imagesWithoutAlt, h1Count }
}
```

- [ ] **Step 4: Create `packages/core/src/health/checks.ts`**

```ts
import type { AuditContext, CheckResult, Owner } from './types'
import { scanBody } from './scan'
import { SITE_CAPABILITIES } from './capabilities'
import type { SiteCapabilities } from './types'

type Evaluator = (ctx: AuditContext) => Omit<CheckResult, 'id'>

const ok = (owner: Owner, detail?: string): Omit<CheckResult, 'id'> => ({ status: 'pass', owner, detail })
const bad = (owner: Owner, detail?: string, offenders?: CheckResult['offenders']): Omit<CheckResult, 'id'> => ({ status: 'fail', owner, detail, offenders })

const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v.trim() !== ''

const cap = (key: keyof SiteCapabilities): Evaluator => (ctx) =>
  ctx.capabilities[key] ? ok('platform') : bad('platform', 'Not emitted by Setu yet — on the roadmap.')

export const EVALUATORS: Record<string, Evaluator> = {
  // config
  'foundations.title': (ctx) => nonEmpty(ctx.settings.general.title) ? ok('config') : bad('config', 'Set a site title in Settings → General.'),
  'foundations.description': (ctx) => nonEmpty(ctx.settings.general.description) ? ok('config') : bad('config', 'Set a site description in Settings → General.'),
  'seo.homepage': (ctx) => ctx.entries.some((e) => e.id === ctx.settings.reading.homepage) ? ok('config') : bad('config', 'The configured homepage does not resolve to an existing page.'),
  'seo.indexable': (ctx) => ctx.settings.reading.searchEngineVisible ? ok('config') : bad('config', 'Search engines are discouraged (noindex). Turn this off in Settings → Content & Reading when ready to launch.'),
  'foundations.feed': (ctx) => ctx.settings.reading.feed.enabled ? ok('config') : bad('config', 'Enable the RSS feed in Settings → Content & Reading.'),
  // content (aggregate over entries; list offenders)
  'foundations.entry-title': (ctx) => {
    const off = ctx.entries.filter((e) => !nonEmpty(e.data.title)).map((e) => ({ ref: e.id, note: 'missing title' }))
    return off.length ? bad('content', `${off.length} entr${off.length === 1 ? 'y' : 'ies'} missing a title`, off) : ok('content')
  },
  'accessibility.image-alt': (ctx) => {
    const off = ctx.entries
      .map((e) => ({ e, n: scanBody(e.body).imagesWithoutAlt }))
      .filter((x) => x.n > 0)
      .map((x) => ({ ref: x.e.id, note: `${x.n} image(s) without alt text` }))
    return off.length ? bad('content', `${off.length} entr${off.length === 1 ? 'y' : 'ies'} with images missing alt text`, off) : ok('content')
  },
  'seo.single-h1': (ctx) => {
    // The template emits the title as the page H1; any H1 in the body is a second one.
    const off = ctx.entries.filter((e) => scanBody(e.body).h1Count > 0).map((e) => ({ ref: e.id, note: 'extra H1 in body' }))
    return off.length ? bad('content', `${off.length} entr${off.length === 1 ? 'y' : 'ies'} with an extra H1`, off) : ok('content')
  },
  'seo.canonical-route': () => ok('platform', 'URLs follow the clean collection/slug convention.'),
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
  'seo.robots-txt': cap('robotsTxt'),
  'seo.json-ld': cap('jsonLd'),
  'agent-readiness.llms-txt': cap('llmsTxt'),
  'agent-readiness.markdown': cap('perPageMarkdown'),
  'i18n.hreflang': cap('hreflang'),
  'resilience.custom-404': cap('customError'),
  'accessibility.skip-link': cap('skipLink'),
  'accessibility.focus-styles': cap('focusStyles'),
}

// `foundations.feed` reflects a capability AND a config toggle; the config evaluator above is
// the source of truth for v1 (the autodiscovery capability flips when #51 merges). Keep one.
void SITE_CAPABILITIES
```

- [ ] **Step 5: Create `packages/core/src/health/run-audit.ts`**

```ts
import type { AuditContext, AuditResult, CheckResult, Category, CategoryScore, Severity } from './types'
import { RUBRIC } from './rubric'
import { EVALUATORS } from './checks'

const WEIGHT: Record<Severity, number> = { required: 10, avoid: 10, recommended: 3, optional: 1 }
const CATEGORIES: Category[] = ['foundations','seo','accessibility','security','well-known','agent-readiness','performance','privacy','resilience','i18n']

const scoreOf = (items: { weight: number; status: CheckResult['status'] }[]): { score: number; pass: number; total: number } => {
  const scored = items.filter((i) => i.status === 'pass' || i.status === 'fail')
  const denom = scored.reduce((s, i) => s + i.weight, 0)
  const passW = scored.filter((i) => i.status === 'pass').reduce((s, i) => s + i.weight, 0)
  return { score: denom === 0 ? 100 : Math.round((passW / denom) * 100), pass: scored.filter((i) => i.status === 'pass').length, total: scored.length }
}

export function runAudit(context: AuditContext): AuditResult {
  const results: CheckResult[] = RUBRIC.map((item) => {
    const ev = EVALUATORS[item.id]
    if (ev) return { id: item.id, ...ev(context) }
    return { id: item.id, status: item.liveProbe ? 'pending' : 'manual', owner: 'manual' }
  })
  const byId = new Map(results.map((r) => [r.id, r]))
  const weighted = RUBRIC.map((i) => ({ weight: WEIGHT[i.severity], status: byId.get(i.id)!.status }))
  const { score } = scoreOf(weighted)
  const band: AuditResult['band'] = score >= 90 ? 'strong' : score >= 70 ? 'good' : 'needs-work'

  const byCategory: CategoryScore[] = CATEGORIES.map((category) => {
    const items = RUBRIC.filter((i) => i.category === category).map((i) => ({ weight: WEIGHT[i.severity], status: byId.get(i.id)!.status }))
    const s = scoreOf(items)
    return { category, score: s.score, pass: s.pass, total: s.total }
  }).filter((c) => RUBRIC.some((i) => i.category === c.category))

  const requiredScored = RUBRIC.filter((i) => i.severity === 'required' && ['pass','fail'].includes(byId.get(i.id)!.status))
  const mustHaves = { done: requiredScored.filter((i) => byId.get(i.id)!.status === 'pass').length, total: requiredScored.length }

  return { results, score, band, byCategory, mustHaves }
}
```

- [ ] **Step 6: Export from `packages/core/src/index.ts`**

```ts
export { scanBody } from './health/scan'
export { EVALUATORS } from './health/checks'
export { runAudit } from './health/run-audit'
```

- [ ] **Step 7: Run test + commit**

Run: `pnpm --filter @setu/core test -- health-audit` → PASS. `pnpm --filter @setu/core typecheck`.
```bash
git add packages/core/src/health/scan.ts packages/core/src/health/checks.ts packages/core/src/health/run-audit.ts packages/core/src/index.ts packages/core/test/health-audit.test.ts
git commit -m "feat(core): runAudit + site-health evaluators (config/content/platform)"
```

---

## Task 3: Admin — audit context loader + dashboard score widget

**Files:**
- Create: `apps/admin/src/health/audit-context.ts`, `apps/admin/src/health/useAudit.ts`, `apps/admin/src/screens/dashboard/SiteHealthCard.tsx`
- Modify: `apps/admin/src/screens/Dashboard.tsx`
- Test: `apps/admin/test/site-health-card.test.tsx`

**Interfaces:**
- Consumes: `runAudit`, `SITE_CAPABILITIES`, `AuditResult`, `parseMdoc`, `parseContentPath` (core); `useServices().git`, `useSettings()`.
- Produces: `loadAuditEntries(git): Promise<AuditEntry[]>`; `useAudit(): { audit: AuditResult | null }`; `<SiteHealthCard/>`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/site-health-card.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AuditResult } from '@setu/core'
import { SiteHealthCardView } from '../src/screens/dashboard/SiteHealthCard'

const audit: AuditResult = {
  results: [], score: 64, band: 'needs-work',
  byCategory: [], mustHaves: { done: 4, total: 7 },
}

describe('SiteHealthCardView', () => {
  it('shows the score, band, and must-have tally', () => {
    render(<MemoryRouter><SiteHealthCardView audit={audit} /></MemoryRouter>)
    expect(screen.getByText('64')).toBeTruthy()
    expect(screen.getByText(/needs work/i)).toBeTruthy()
    expect(screen.getByText(/4\s*\/\s*7/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test -- site-health-card`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/admin/src/health/audit-context.ts`**

```ts
import { parseMdoc, parseContentPath, type AuditEntry } from '@setu/core'
import type { GitPort } from '@setu/core'

const COLLECTIONS = ['post', 'page']

/** The site's published content = committed .mdoc files (drafts live only in the DB), minus
 *  entries explicitly marked `published: false`. Mirrors what the site build sees. */
export async function loadAuditEntries(git: GitPort): Promise<AuditEntry[]> {
  const out: AuditEntry[] = []
  for (const collection of COLLECTIONS) {
    for (const path of await git.list(`content/${collection}/`)) {
      const ref = parseContentPath(path)
      if (ref === null) continue
      const raw = await git.readFile(path)
      if (raw === null) continue
      const { frontmatter, body } = parseMdoc(raw)
      if (frontmatter.published === false) continue
      out.push({ id: `${ref.collection}/${ref.locale}/${ref.slug}`, data: frontmatter, body })
    }
  }
  return out
}
```
> Verify `parseContentPath` is exported from `@setu/core` (it is used by `apps/admin/src/dashboard/entries.ts`); if it lives at a deeper import path, match that. Confirm `GitPort` is exported from `@setu/core`.

- [ ] **Step 4: Create `apps/admin/src/health/useAudit.ts`**

```ts
import { useEffect, useState } from 'react'
import { runAudit, SITE_CAPABILITIES, type AuditResult } from '@setu/core'
import { useServices } from '../data/store'
import { useSettings } from '../data/settings-store'
import { loadAuditEntries } from './audit-context'

/** Loads committed content + settings, runs the audit in-memory. No network, no build. */
export function useAudit(): { audit: AuditResult | null } {
  const { git } = useServices()
  const settings = useSettings()
  const [audit, setAudit] = useState<AuditResult | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      const entries = await loadAuditEntries(git)
      const result = runAudit({
        settings: {
          general: { title: settings.general.title, description: settings.general.description },
          reading: { homepage: settings.reading.homepage, searchEngineVisible: settings.reading.searchEngineVisible, feed: { enabled: settings.reading.feed.enabled } },
        },
        entries,
        capabilities: SITE_CAPABILITIES,
      })
      if (live) setAudit(result)
    })()
    return () => { live = false }
  }, [git, settings])
  return { audit }
}
```

- [ ] **Step 5: Create `apps/admin/src/screens/dashboard/SiteHealthCard.tsx`**

```tsx
import { Link } from 'react-router-dom'
import type { AuditResult } from '@setu/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAudit } from '../../health/useAudit'

const BAND: Record<AuditResult['band'], { label: string; cls: string }> = {
  strong: { label: 'Strong', cls: 'text-green-600' },
  good: { label: 'Good', cls: 'text-amber-600' },
  'needs-work': { label: 'Needs work', cls: 'text-red-600' },
}

/** Presentational — takes an audit so it's easy to test. */
export function SiteHealthCardView({ audit }: { audit: AuditResult }) {
  const band = BAND[audit.band]
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">Site Health</CardTitle>
      </CardHeader>
      <CardContent className="flex items-end justify-between">
        <div>
          <div className={`text-4xl font-bold ${band.cls}`}>{audit.score}</div>
          <div className={`text-sm font-medium ${band.cls}`}>{band.label}</div>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div>Must-haves: <span className="font-semibold text-foreground">{audit.mustHaves.done} / {audit.mustHaves.total}</span></div>
          <Link to="/health" className="text-primary hover:underline">View report →</Link>
        </div>
      </CardContent>
    </Card>
  )
}

export function SiteHealthCard() {
  const { audit } = useAudit()
  if (!audit) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Site Health</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Checking…</CardContent>
      </Card>
    )
  }
  return <SiteHealthCardView audit={audit} />
}
```

- [ ] **Step 6: Mount it in `apps/admin/src/screens/Dashboard.tsx`**

Import `import { SiteHealthCard } from './dashboard/SiteHealthCard'` and render `<SiteHealthCard />` in the left-column widget stack (the `space-y-5` group, alongside `StatTiles`/`SiteDeployCard`).

- [ ] **Step 7: Run test + typecheck + commit**

Run: `pnpm --filter @setu/admin test -- site-health-card` → PASS. `pnpm --filter @setu/admin typecheck`.
```bash
git add apps/admin/src/health/audit-context.ts apps/admin/src/health/useAudit.ts apps/admin/src/screens/dashboard/SiteHealthCard.tsx apps/admin/src/screens/Dashboard.tsx apps/admin/test/site-health-card.test.tsx
git commit -m "feat(admin): Site Health dashboard score widget + audit context"
```

---

## Task 4: Admin — Site Health screen + route + nav

**Files:**
- Create: `apps/admin/src/screens/SiteHealth.tsx`
- Modify: `apps/admin/src/app.tsx` (route), `apps/admin/src/shell/AppSidebar.tsx` (nav)
- Test: `apps/admin/test/site-health-screen.test.tsx`

**Interfaces:**
- Consumes: `useAudit` (Task 3), `RUBRIC`, `AuditResult`/`CheckResult` (core).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/site-health-screen.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AuditResult } from '@setu/core'
import { SiteHealthView } from '../src/screens/SiteHealth'

const audit: AuditResult = {
  score: 60, band: 'needs-work', byCategory: [], mustHaves: { done: 3, total: 6 },
  results: [
    { id: 'foundations.description', status: 'fail', owner: 'config' },
    { id: 'seo.canonical', status: 'fail', owner: 'platform' },
    { id: 'security.hsts', status: 'pending', owner: 'manual' },
    { id: 'foundations.title', status: 'pass', owner: 'config' },
  ],
}

describe('SiteHealthView', () => {
  it('groups failures by owner: fix-now vs roadmap vs manual', () => {
    render(<SiteHealthView audit={audit} />)
    expect(screen.getByText(/fix now/i)).toBeTruthy()
    expect(screen.getByText(/on setu.s roadmap/i)).toBeTruthy()
    expect(screen.getByText(/manual/i)).toBeTruthy()
    // a config fail appears under fix-now with its rubric title
    expect(screen.getByText(/meta description/i)).toBeTruthy()
    // platform fail appears under roadmap
    expect(screen.getByText(/canonical url/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test -- site-health-screen`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/admin/src/screens/SiteHealth.tsx`**

```tsx
import type { AuditResult, CheckResult, RubricItem } from '@setu/core'
import { RUBRIC } from '@setu/core'
import { PageHeader } from '../shell/PageHeader'
import { PageBody } from '../shell/PageBody'
import { Badge } from '@/components/ui/badge'
import { useAudit } from '../health/useAudit'

const ITEM = new Map<string, RubricItem>(RUBRIC.map((r) => [r.id, r]))
const SEV_LABEL: Record<RubricItem['severity'], string> = { required: 'Must', avoid: 'Must-not', recommended: 'Should', optional: 'Nice' }

function Row({ r }: { r: CheckResult }) {
  const item = ITEM.get(r.id)
  if (!item) return null
  const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '–'
  return (
    <div className="flex items-start gap-3 border-b border-border py-2.5">
      <span className="w-4 text-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{item.title}</span>
          <Badge variant="secondary">{SEV_LABEL[item.severity]}</Badge>
          <Badge variant="outline">{r.owner}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{r.detail ?? item.guidance}</p>
        {r.offenders && r.offenders.length > 0 && (
          <ul className="mt-1 text-xs text-muted-foreground">
            {r.offenders.slice(0, 10).map((o) => <li key={o.ref}>{o.ref} — {o.note}</li>)}
          </ul>
        )}
        <a href={item.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Learn more</a>
      </div>
    </div>
  )
}

function Section({ title, results }: { title: string; results: CheckResult[] }) {
  if (results.length === 0) return null
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {results.map((r) => <Row key={r.id} r={r} />)}
    </section>
  )
}

export function SiteHealthView({ audit }: { audit: AuditResult }) {
  const fixNow = audit.results.filter((r) => r.status === 'fail' && (r.owner === 'config' || r.owner === 'content'))
  const roadmap = audit.results.filter((r) => r.status === 'fail' && r.owner === 'platform')
  const manual = audit.results.filter((r) => r.status === 'pending' || r.status === 'manual')
  const passing = audit.results.filter((r) => r.status === 'pass')
  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-end gap-4">
        <div className="text-5xl font-bold">{audit.score}</div>
        <div className="text-muted-foreground">
          <div className="capitalize">{audit.band.replace('-', ' ')}</div>
          <div className="text-sm">Must-haves {audit.mustHaves.done} / {audit.mustHaves.total}</div>
        </div>
      </div>
      <p className="mb-6 text-xs text-muted-foreground">Audited against the <a className="underline" href="https://specification.website/" target="_blank" rel="noreferrer">Website Specification</a>.</p>
      <Section title="Fix now (you)" results={fixNow} />
      <Section title="On Setu's roadmap" results={roadmap} />
      <Section title="Manual / live checks" results={manual} />
      <Section title="Passing" results={passing} />
    </div>
  )
}

export function SiteHealth() {
  const { audit } = useAudit()
  return (
    <>
      <PageHeader title="Site Health" subtitle="How your site measures up to web best practices" />
      <PageBody>{audit ? <SiteHealthView audit={audit} /> : <p className="text-sm text-muted-foreground">Checking…</p>}</PageBody>
    </>
  )
}
```
> Confirm `PageHeader`/`PageBody` import paths + props match existing screens (e.g. `ContentList`). If `Badge` needs adding, install via the shadcn MCP per CLAUDE.md (it's already in `components/ui/badge.tsx`).

- [ ] **Step 4: Add the route + nav**

In `apps/admin/src/app.tsx`: import `SiteHealth` and add `<Route path="/health" element={<SiteHealth />} />` next to the other routes.
In `apps/admin/src/shell/AppSidebar.tsx`: import an icon (e.g. `Activity` from `lucide-react`) and add `{ to: '/health', label: 'Site Health', icon: Activity }` to the Workspace group's `items`.

- [ ] **Step 5: Run test + typecheck + commit**

Run: `pnpm --filter @setu/admin test -- site-health-screen` → PASS. `pnpm --filter @setu/admin typecheck`.
```bash
git add apps/admin/src/screens/SiteHealth.tsx apps/admin/src/app.tsx apps/admin/src/shell/AppSidebar.tsx apps/admin/test/site-health-screen.test.tsx
git commit -m "feat(admin): Site Health screen + route + nav"
```

---

## Task 5: Capability honesty test (keeps the map true)

**Files:**
- Create: `apps/site/test/capabilities.test.ts`

**Interfaces:**
- Consumes: `SITE_CAPABILITIES` (core); the built site `dist/`.

- [ ] **Step 1: Write the test**

Model it on `apps/site/test/render.test.ts` (which builds the site in `beforeAll` and reads `dist/<route>/index.html`). Assert each capability flag matches the actual built output, so the map can't drift.

```ts
// apps/site/test/capabilities.test.ts
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { SITE_CAPABILITIES } from '@setu/core'

const appDir = fileURLToPath(new URL('..', import.meta.url))
let head = ''

beforeAll(() => {
  // Reuse a built dist if render.test already produced one this run; otherwise build.
  if (!existsSync(join(appDir, 'dist', 'index.html'))) {
    execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  }
  head = readFileSync(join(appDir, 'dist', 'index.html'), 'utf8')
}, 180_000)

const has = (re: RegExp) => re.test(head)
const distHas = (p: string) => existsSync(join(appDir, 'dist', p))

describe('SITE_CAPABILITIES matches real output', () => {
  it('head-tag capabilities are accurate', () => {
    expect(SITE_CAPABILITIES.charset).toBe(has(/<meta charset/i))
    expect(SITE_CAPABILITIES.viewport).toBe(has(/name="viewport"/i))
    expect(SITE_CAPABILITIES.canonical).toBe(has(/rel="canonical"/i))
    expect(SITE_CAPABILITIES.openGraph).toBe(has(/property="og:/i))
    expect(SITE_CAPABILITIES.favicon).toBe(has(/rel="icon"/i))
    expect(SITE_CAPABILITIES.themeColor).toBe(has(/name="theme-color"/i))
  })
  it('file-based capabilities are accurate', () => {
    expect(SITE_CAPABILITIES.sitemap).toBe(distHas('sitemap.xml') || distHas('sitemap-index.xml'))
    expect(SITE_CAPABILITIES.robotsTxt).toBe(distHas('robots.txt'))
    expect(SITE_CAPABILITIES.customError).toBe(distHas('404.html'))
    expect(SITE_CAPABILITIES.llmsTxt).toBe(distHas('llms.txt'))
  })
})
```
> If a fresh build needs generated blocks first, run `node ../../scripts/gen-blocks.mjs` (+ `gen-relations.mjs`) in `beforeAll` before `pnpm build`, mirroring the project's prebuild. Confirm against how `render.test.ts` sets up its build.

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @setu/site test -- capabilities`
Expected: PASS — every assertion matches the current map (all the absent ones are `false`).

- [ ] **Step 3: Commit**

```bash
git add apps/site/test/capabilities.test.ts
git commit -m "test(site): capability map honesty check against built output"
```

**Final:** whole-branch review (`superpowers:requesting-code-review`), then `superpowers:finishing-a-development-branch`.

---

## Self-Review (author checklist — completed)

**1. Spec coverage:** vendored rubric + capability map + types (T1); pure `runAudit` + config/content/platform evaluators + scoring/must-haves/bands (T2); admin context loader + dashboard score widget (T3); `/health` screen grouped by owner + route + nav (T4); capability honesty test (T5); live-probe items present as `pending`, manual items as `manual`, both excluded from score (T2 `run-audit`); attribution + spec links (T1 data, T4 UI); no runtime phone-home (all pure/local). ✅ v2 live probes + emitters explicitly out of scope (spec Non-Goals).

**2. Placeholder scan:** No TBD/TODO. Every code step has complete code. Three "verify against real X" notes (parseContentPath export, PageHeader/PageBody props, render-test build setup) name the exact symbol + where it's already used — confirmations, not gaps.

**3. Type consistency:** `RubricItem`/`SiteCapabilities`/`AuditEntry`/`AuditContext`/`CheckResult`/`AuditResult`/`CategoryScore`, `RUBRIC`/`SITE_CAPABILITIES`/`EVALUATORS`/`runAudit`/`scanBody`, severity weights, owner values, and band thresholds are consistent across T1–T5. Evaluator ids match RUBRIC ids (e.g. `seo.canonical`, `security.hsts`). `useAudit`/`SiteHealthCardView`/`SiteHealthView` signatures match their tests.

**Open questions:** O1 (render harness for the capability test — confirmed: `render.test.ts` builds + reads `dist/`), O2 (content source — committed content via `git.list`+`parseMdoc`, published filter), O3 (recompute on mount) — all resolved in the plan above.

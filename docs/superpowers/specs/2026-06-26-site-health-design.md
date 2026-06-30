# Site Health — Design

**Date:** 2026-06-26
**Status:** Approved (brainstorm complete) — ready for implementation plan
**Branch:** `site-health` (off `main`)

## Summary

A **Site Health** scorecard in the admin that audits the site against the
[specification.website](https://specification.website/) standard (10 categories of technical
best practices) and tells the owner **what they're doing right, what to improve, and what's
missing from the product itself**. A weighted 0–100 score + colour band lands on the dashboard;
a dedicated **Site Health** screen gives the per-category breakdown with per-item status, owner,
severity, and fix guidance.

The rubric is **vendored into Setu** (a snapshot of the spec) — **no runtime phone-home**; the
specification.website **MCP is a maintainer-time sync tool only**. v1 is the **deterministic
framework + all auto-verifiable checks** (config, content, platform-capability). Items that
require live measurement (security headers, Core Web Vitals) appear in the rubric immediately as
**"live check — pending"** and are implemented in a **v2 live-probes** increment.

## Goals

- A vendored rubric (specification.website items: id, category, severity, short guidance,
  spec-link) as data in `@setu/core`. No runtime external calls.
- A pure `runAudit(context) → { results, score, byCategory }` in `@setu/core` (unit-testable).
- **Three evaluable check flavors**, each result tagged by **owner**: **You · config**, **You ·
  content**, **Setu · platform** (capability gaps) — plus a **Manual / live** bucket (listed,
  not scored in v1).
- A **capability map** of what the theme + site pipeline emit, kept honest by a test against
  actual rendered output. This map is the **product-gap radar** — emitter PRs flip a flag and a
  check turns green.
- A **dashboard score widget** + a **Site Health screen** (shadcn-first; CLAUDE.md rule).
- Honest scoring: weighted by severity, **auto-verifiable items only** in the denominator,
  must-haves surfaced separately.

## Non-Goals (deferred)

- **v2 live probes** — security headers (server-side fetch of the deployed site) + Core Web
  Vitals (Cloudflare Web Analytics / PageSpeed Insights). Their rubric items appear in v1 as
  "live check — pending"; the measurement lands in v2.
- The **emitters themselves** (canonical, Open Graph, favicon, `sitemap.xml`, `robots.txt`,
  JSON-LD, `llms.txt`, hreflang, custom 404, skip link, focus styles) — each is its own future
  increment that flips a capability green. Site Health *surfaces* these gaps; it doesn't build
  them.
- Content-authoring "manual" items (privacy policy, cookie consent) — listed with guidance, not
  scored.
- Per-theme capability maps (v1 targets `theme-default`).
- Historical score tracking / trend over time.

## Architecture

```
@setu/core
  rubric.ts          vendored specification.website items (data) — id, category, severity, guidance, url
  capabilities.ts    SITE_CAPABILITIES: what theme-default + pipeline emit (flags)
  checks/*.ts        evaluator per checkable item: (context) => CheckResult
  run-audit.ts       runAudit(context): pure → { results[], score, byCategory, mustHaves }
        ▲ context = { settings, entries, capabilities }
        │
apps/admin
  data gathering: settings-store (settings) + content index (entries{id,data,body})
  Dashboard.tsx → <SiteHealthCard/>  (headline score + band + must-have tally → links to /health)
  screens/SiteHealth.tsx (/health)   per-category breakdown, item rows, owner/severity/guidance
```

### 1. Vendored rubric (`@setu/core/src/health/rubric.ts`)

A typed array of rubric items snapshotted from specification.website:

```ts
type Severity = 'required' | 'recommended' | 'optional' | 'avoid'  // Must / Should / Nice / Must-not
type Category = 'foundations' | 'seo' | 'accessibility' | 'security' | 'well-known'
              | 'agent-readiness' | 'performance' | 'privacy' | 'resilience' | 'i18n'
interface RubricItem {
  id: string            // stable slug, e.g. 'foundations.canonical'
  category: Category
  severity: Severity
  title: string
  guidance: string      // short summary (see Licensing below)
  url: string           // deep link to the spec page
}
```

**Licensing/attribution (to verify before writing the data):** confirm specification.website's
license/terms. Default stance — store **short paraphrased summaries** + the canonical
**deep-link** ("Learn more on specification.website"), and credit the source in the UI; avoid
copying long guidance verbatim unless the license permits.

**Maintainer sync (not runtime):** a dev script (`scripts/sync-health-rubric.mjs`, optional in
v1) calls the spec MCP (`https://mcp.specification.website/mcp` — `get_checklist`/`list_topics`/
`get_topic`) to regenerate `rubric.ts`. The running app never calls it.

### 2. Capability map (`@setu/core/src/health/capabilities.ts`)

```ts
interface SiteCapabilities {
  doctype: boolean; langAttr: boolean; charset: boolean; viewport: boolean
  title: boolean; metaDescription: boolean; canonical: boolean; favicon: boolean
  openGraph: boolean; twitterCard: boolean; themeColor: boolean; rssAutodiscovery: boolean
  sitemap: boolean; robotsTxt: boolean; jsonLd: boolean
  llmsTxt: boolean; perPageMarkdown: boolean
  hreflang: boolean; customError: boolean; skipLink: boolean; focusStyles: boolean
}
export const SITE_CAPABILITIES: SiteCapabilities = { /* current truth for theme-default */ }
```

Initial truth (from the survey): `doctype/langAttr/charset/viewport/title/metaDescription = true`;
everything else `false` (`rssAutodiscovery` flips true when #51 merges). **Honesty test**
(`apps/site/test`): render a sample page via the existing render harness and assert each
capability flag matches the actual `<head>`/output (so the map can't silently drift). Emitter
increments flip a flag + the test enforces it.

### 3. Checks + `runAudit` (`@setu/core/src/health/`)

Each checkable rubric item gets an evaluator `(context) => CheckResult`:

```ts
type Owner = 'config' | 'content' | 'platform' | 'manual'
type Status = 'pass' | 'fail' | 'manual' | 'pending'   // pending = live-probe item (v2)
interface CheckResult {
  id: string; status: Status; owner: Owner
  detail?: string                 // e.g. "3 posts have images without alt text"
  offenders?: { ref: string; note: string }[]  // entries needing content fixes
}
interface AuditContext {
  settings: SiteSettings
  entries: { id: string; data: Record<string, unknown>; body: string }[]  // published content
  capabilities: SiteCapabilities
}
runAudit(context): { results: CheckResult[]; score: number; byCategory: Record<Category,{score:number;...}>; mustHaves: { done: number; total: number } }
```

Scoring (the approved model): weight `required/avoid = 10`, `recommended = 3`, `optional = 1`.
**Denominator = sum of weights of `pass|fail` (auto-verifiable) results only**;
`manual`/`pending` are excluded from the score (shown separately). `score = Σ(weight of pass) /
Σ(weight of pass+fail) × 100`. `mustHaves` counts `required` pass/total. Bands: ≥90 green
"Strong", 70–89 amber "Good", <70 red "Needs work".

### v1 check catalog (auto-verifiable)

**Config (You · config — from `settings`):**
- `foundations.title` — site title set (Must).
- `foundations.description` — site description set (Should).
- `seo.homepage-set` — `reading.homepage` resolves to an existing page (Must).
- `seo.indexable` — `reading.searchEngineVisible` true; if false, **fail with "site is set to
  noindex"** (Must — accidental noindex is the classic SEO footgun).
- `foundations.feed` — `reading.feed.enabled` (Optional) *(meaningful once #51 merges).*

**Content (You · content — from `entries`, per-entry, report offenders):**
- `foundations.entry-title` — every published entry has a non-empty title (Must).
- `accessibility.image-alt` — content images have non-empty `alt` (Should); offenders listed.
- `seo.single-h1` — entry body adds no second `<h1>`/`# ` beyond the template's (Should).

**Platform-capability (Setu · platform — from `SITE_CAPABILITIES`):**
- Must: `seo.sitemap`, `seo.canonical`. Should: `foundations.favicon`, `foundations.open-graph`,
  `seo.robots-txt`, `seo.json-ld`, `agent.llms-txt`, `resilience.custom-404`,
  `accessibility.skip-link`, `accessibility.focus-styles`, `i18n.hreflang`. Optional:
  `foundations.twitter-card`, `foundations.theme-color`.
- Always-pass capabilities (proof the framework rewards what Setu does right):
  `foundations.doctype/lang/charset/viewport`.

**Manual / live (listed, status `manual` or `pending` — NOT scored in v1):**
- Security: HTTPS, HSTS, CSP, X-Content-Type-Options, clickjacking, cookie attrs → **pending
  (v2 header probe).**
- Performance: Core Web Vitals, compression, caching → **pending (v2 CWV).**
- Privacy: privacy policy, cookie consent, GPC → **manual.**
- Well-known URIs → **manual.**

### 4. Admin UI (shadcn-first)

- **`<SiteHealthCard/>`** in `Dashboard.tsx`: headline **score + colour band** + "Must-haves
  N/M" + a one-line worst-offender hint; links to `/health`. Computes via `runAudit` from
  settings-store + the content index.
- **`SiteHealth.tsx` (`/health`)**: overall score ring, per-category sub-scores, and item rows
  grouped **"Fix now (you)"** (config/content fails) vs **"On Setu's roadmap"** (platform
  fails) vs **"Manual / live"** (manual+pending). Each row: status icon, title, **severity
  chip** (Must/Should/Nice), **owner chip**, short guidance, "Learn more" → spec link. Config
  fails deep-link to the relevant Settings screen; content fails link to the offending entry.

## Data flow

Admin loads settings (settings-store) + published entries (content index) → builds
`AuditContext` with `SITE_CAPABILITIES` → `runAudit` (pure) → score + results → dashboard widget
+ `/health` screen render. Recomputed on screen mount (cheap, in-memory). No build, no network,
no phone-home.

## Error handling

- Missing settings/entries → `runAudit` degrades (a check with no data → `manual`/skipped, never
  throws).
- Unknown rubric item with no evaluator → listed as `manual` (visible, unscored) — so adding a
  rubric item never breaks the audit.
- Empty site (no content) → content checks skip; score reflects config + capability only.
- The capability honesty-test failing in CI signals the map drifted from reality (a real
  emitter shipped/regressed) — fix the map.

## Testing

- **Core:** `runAudit` scoring math (weights, auto-verifiable denominator, must-have tally,
  bands); each evaluator (config: noindex→fail, missing description→fail; content: image
  without alt → fail + offenders, second h1 → fail; platform: reads the capability flag).
- **Capability honesty test (`apps/site`):** render a sample page; assert each `SITE_CAPABILITIES`
  flag matches the real `<head>`/output.
- **Admin:** `<SiteHealthCard/>` renders a band for a given audit result; `/health` groups
  fails by owner. (jsdom; mirror existing admin tests.)

## Rollout / dependencies

- Off `main`. No new runtime deps (rubric is vendored data; checks are pure). Admin UI uses
  existing shadcn components (add any missing via the shadcn MCP per CLAUDE.md).
- **v2 (live probes):** a server-side tier in `apps/api` — security-headers probe (fetch
  `SETU_SITE_URL`, inspect headers; self-contained) + CWV (Cloudflare Web Analytics GraphQL or
  PSI; token in **env**). Flips the `pending` items to measured. Separate increment.
- **The capability gaps are the emitter backlog** — each becomes its own increment
  (canonical/OG/favicon/sitemap/robots.txt/JSON-LD/llms.txt[=increment #3]/hreflang/404/skip-link/
  focus-styles), and #51's RSS flips `rssAutodiscovery`.
- Attribution to specification.website in the `/health` UI; verify license before vendoring text.

## Open questions (resolve during planning)

- **O1 — capability honesty test mechanism:** reuse `apps/site/test`'s render harness to inspect
  a sample page's `<head>` (preferred) vs a lighter Layout-source grep. Lean: render harness
  (real output). Confirm the harness can render a page to HTML in-test.
- **O2 — content scan source:** does the admin already expose published entries with `body` for
  scanning (image alt / h1), or does the audit read via `getCollection`/the index? Lean: the
  content index (it carries `data`+`body`); confirm the published-only filter.
- **O3 — score recompute trigger:** on `/health` mount + dashboard mount (chosen) vs a manual
  "re-run" button. Lean: auto on mount (cheap); add a refresh affordance.

## Decisions log (from brainstorm)

- Engine **A**: Setu-native deterministic checks, rubric vendored from specification.website;
  **no runtime phone-home** (MCP = maintainer sync only). **(approved)**
- **Dashboard score** + Site Health screen; weighted severity scoring (Must=10/Should=3/Nice=1),
  **auto-verifiable-only denominator**, must-haves surfaced. **(approved)**
- **"The whole thing"** — implement the full auto-verifiable check set incl. platform-capability
  gaps; the gap list **is** Setu's product-gap radar. Owner-tagged so users aren't told to fix
  platform gaps. **(approved)**
- **Live probes** (headers + CWV) are a **v2** server-side tier; items visible as "pending" in
  v1. Headers via self-contained server fetch (browser/CORS can't read them); CWV via Cloudflare
  Web Analytics / PSI. cloudflare/skills `web-perf` is an *agent skill*, not a runtime lib.
  **(approved)**

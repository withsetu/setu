export type Severity = 'required' | 'recommended' | 'optional' | 'avoid'
export type HealthCategory =
  | 'foundations'
  | 'seo'
  | 'accessibility'
  | 'security'
  | 'well-known'
  | 'agent-readiness'
  | 'performance'
  | 'privacy'
  | 'resilience'
  | 'i18n'
export type Owner = 'config' | 'content' | 'platform' | 'manual'
export type CheckStatus = 'pass' | 'fail' | 'unverified' | 'pending' | 'na'

export interface RubricItem {
  id: string
  category: HealthCategory
  severity: Severity
  title: string
  guidance: string
  url: string
  /** Items needing a live-site probe (security headers, CWV) — show as `pending` in v1. */
  liveProbe?: boolean
  /** SCAN class (#593): the check reads per-entry content facts (title / image-alt /
   *  extra-H1 / homepage-resolves), so it runs only against the cached, index-backed
   *  content scan — never on every dashboard mount. Everything else is INSTANT
   *  (config / settings / platform / attestation), computed live with no content. */
  needsScan?: boolean
}

export interface SiteCapabilities {
  doctype: boolean
  langAttr: boolean
  charset: boolean
  viewport: boolean
  title: boolean
  metaDescription: boolean
  canonical: boolean
  favicon: boolean
  openGraph: boolean
  twitterCard: boolean
  themeColor: boolean
  rssAutodiscovery: boolean
  sitemap: boolean
  sitemapIndex: boolean
  imageSitemaps: boolean
  robotsTxt: boolean
  jsonLd: boolean
  llmsTxt: boolean
  perPageMarkdown: boolean
  hreflang: boolean
  customError: boolean
  skipLink: boolean
  focusStyles: boolean
}

export interface AuditEntry {
  id: string // collection/locale/slug
  data: Record<string, unknown> // frontmatter
  body: string // raw markdoc body
}

export interface AttestationRecord {
  state: 'attested' | 'na'
  at: string
  by: string
}
export interface HealthState {
  items: Record<string, AttestationRecord>
  sections: Record<string, AttestationRecord> // keyed by HealthCategory
}

export interface AuditContext {
  settings: {
    general: { title: string; description: string }
    reading: {
      homepage: string
      searchEngineVisible: boolean
      feed: { enabled: boolean }
    }
  }
  capabilities: SiteCapabilities
  health: HealthState
  /** Index-backed content facts for the SCAN-class checks (#593). `null` = not
   *  scanned yet: those checks report `pending` ("run a scan") and score-neutral,
   *  and i18n stays applicable until a scan reveals the locale count. */
  scan: AuditScanData | null
}

/** The content facts the SCAN-class checks consume — the same shape the index
 *  aggregates in `AuditSummary` (aliased so the two never drift). Produced by the
 *  index (`auditSummary()`) or, for the browser-only topology, by
 *  `auditScanFromEntries`. */
export type AuditScanData = import('../index-port/audit-summary').AuditSummary

export interface CheckResult {
  id: string
  status: CheckStatus
  owner: Owner
  detail?: string
  offenders?: { ref: string; note: string }[]
  /** Non-auto item the admin can attest ("I've verified this"). */
  attestable?: boolean
  /** Why an item is N/A: auto-detected vs admin-set. */
  naSource?: 'auto' | 'manual'
  /** ISO timestamp of the live probe that produced this result (liveProbe items). */
  probedAt?: string
}

/** What a live probe observed about the deployed site — the pure input to `evaluateProbe`.
 *  Sourced server-side (apps/api) via `safeFetch`; kept minimal so the evaluator is pure. */
export interface ProbeInput {
  /** URL actually reached, after any redirects (e.g. an http→https upgrade). */
  finalUrl: string
  status: number
  headers: Headers
}

/** One live-probe rubric item's verdict. `id` matches a `liveProbe` RubricItem. */
export interface ProbeItemResult {
  id: string
  status: 'pass' | 'fail'
  detail: string
}

/** A completed probe run, ready to merge into a client audit. */
export interface ProbeReport {
  probedAt: string
  results: ProbeItemResult[]
}

/** API `/api/sitehealth/probe` response: either a completed report, or an honest
 *  "couldn't run" with a machine-readable reason (never a false pass/fail). */
export type ProbeResponse =
  | ({ available: true } & ProbeReport)
  | { available: false; reason: string; detail?: string }

export interface CategoryScore {
  category: HealthCategory
  score: number
  pass: number
  total: number
}

export interface AuditResult {
  results: CheckResult[]
  score: number
  band: 'strong' | 'good' | 'needs-work'
  byCategory: CategoryScore[]
  mustHaves: { done: number; total: number }
}

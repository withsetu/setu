export type Severity = 'required' | 'recommended' | 'optional' | 'avoid'
export type HealthCategory =
  | 'foundations' | 'seo' | 'accessibility' | 'security' | 'well-known'
  | 'agent-readiness' | 'performance' | 'privacy' | 'resilience' | 'i18n'
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

export interface AttestationRecord { state: 'attested' | 'na'; at: string; by: string }
export interface HealthState {
  items: Record<string, AttestationRecord>
  sections: Record<string, AttestationRecord> // keyed by HealthCategory
}

export interface AuditContext {
  settings: { general: { title: string; description: string }; reading: { homepage: string; searchEngineVisible: boolean; feed: { enabled: boolean } } }
  entries: AuditEntry[]
  capabilities: SiteCapabilities
  health: HealthState
}

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
}

export interface CategoryScore { category: HealthCategory; score: number; pass: number; total: number }

export interface AuditResult {
  results: CheckResult[]
  score: number
  band: 'strong' | 'good' | 'needs-work'
  byCategory: CategoryScore[]
  mustHaves: { done: number; total: number }
}

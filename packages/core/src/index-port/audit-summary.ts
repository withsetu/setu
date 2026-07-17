import type { EntryIndexRow } from './types'

/** Body-free Site Health content facts, aggregated from the index (#593).
 *
 *  The Site Health rubric's 5 content-dependent checks (missing title, images
 *  without alt, extra body H1, homepage-resolves, distinct-locales) used to read
 *  every published `.mdoc` from Git on every dashboard mount — O(entries) HTTP
 *  reads. The index already parses each entry when it builds, so it precomputes
 *  the cheap per-entry facts (see `EntryIndexRow.audit`) and this aggregate rolls
 *  them up with zero further content reads.
 *
 *  Offender lists and id/locale sets are scoped to AUDITED entries — committed
 *  content with `published !== false`, matching the old `loadAuditEntries`
 *  filter exactly. Everything is sorted so the shape is deterministic across
 *  adapters (the contract suite and the audit's parity test rely on it). */
export interface AuditSummary {
  /** Audited entry ids (`collection/locale/slug`) with no frontmatter title. */
  titleOffenders: string[]
  /** Audited entry ids whose body has image(s) missing alt text, with the count. */
  altOffenders: { ref: string; count: number }[]
  /** Audited entry ids with an extra body `<h1>` (the template already emits one). */
  h1Offenders: string[]
  /** Every audited entry id — the set the homepage-resolves check looks in. */
  entryIds: string[]
  /** Distinct locales among audited entries — drives i18n applicability. */
  locales: string[]
}

const entryId = (r: EntryIndexRow): string =>
  `${r.collection}/${r.locale}/${r.slug}`

/** Roll up the precomputed per-row audit facts into an {@link AuditSummary}.
 *  The single pure impl every IndexPort adapter delegates to (cf. runQuery),
 *  so contract semantics match by construction. */
export function selectAuditSummary(rows: EntryIndexRow[]): AuditSummary {
  const titleOffenders: string[] = []
  const altOffenders: { ref: string; count: number }[] = []
  const h1Offenders: string[] = []
  const entryIds: string[] = []
  const locales = new Set<string>()
  for (const r of rows) {
    if (!r.audit.audited) continue
    const id = entryId(r)
    entryIds.push(id)
    if (r.locale) locales.add(r.locale)
    if (!r.audit.hasTitle) titleOffenders.push(id)
    if (r.audit.imagesWithoutAlt > 0)
      altOffenders.push({ ref: id, count: r.audit.imagesWithoutAlt })
    if (r.audit.h1Count > 0) h1Offenders.push(id)
  }
  titleOffenders.sort()
  h1Offenders.sort()
  entryIds.sort()
  altOffenders.sort((a, b) => a.ref.localeCompare(b.ref))
  return {
    titleOffenders,
    altOffenders,
    h1Offenders,
    entryIds,
    locales: [...locales].sort()
  }
}

/** An empty summary — a never-built index or a site with no published content. */
export const EMPTY_AUDIT_SUMMARY: AuditSummary = {
  titleOffenders: [],
  altOffenders: [],
  h1Offenders: [],
  entryIds: [],
  locales: []
}

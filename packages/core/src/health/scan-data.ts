import type { AuditEntry, AuditScanData } from './types'
import { scanBody } from '../markdoc/scan-body'

/** The rubric items whose evaluator reads per-entry content (`needsScan`), i.e.
 *  the SCAN class. Kept here as the single source of truth so the rubric, the
 *  runner, and the classification test all agree. The i18n *applicability*
 *  predicate is also content-dependent (locale count) but rides the same
 *  `AuditScanData` rather than being a rubric item — see run-audit / checks. */
export const SCAN_ITEM_IDS = [
  'foundations.entry-title',
  'accessibility.image-alt',
  'seo.single-h1',
  'seo.homepage'
] as const

const nonEmpty = (v: unknown): boolean =>
  typeof v === 'string' && v.trim() !== ''

/** Derive {@link AuditScanData} directly from already-loaded audit entries — the
 *  reference implementation (the index's `selectAuditSummary` must agree with it)
 *  and the path the browser-only topology uses when no server index is present.
 *  Entries passed here are the AUDITED set (published, committed) already. */
export function auditScanFromEntries(entries: AuditEntry[]): AuditScanData {
  const titleOffenders: string[] = []
  const altOffenders: { ref: string; count: number }[] = []
  const h1Offenders: string[] = []
  const entryIds: string[] = []
  const locales = new Set<string>()
  for (const e of entries) {
    entryIds.push(e.id)
    const locale = e.id.split('/')[1]
    if (locale) locales.add(locale)
    if (!nonEmpty(e.data.title)) titleOffenders.push(e.id)
    const { imagesWithoutAlt, h1Count } = scanBody(e.body)
    if (imagesWithoutAlt > 0)
      altOffenders.push({ ref: e.id, count: imagesWithoutAlt })
    if (h1Count > 0) h1Offenders.push(e.id)
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

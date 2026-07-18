import { describe, it, expect } from 'vitest'
import {
  RUBRIC,
  runAudit,
  runInstantChecks,
  runScanChecks,
  auditScanFromEntries,
  selectAuditSummary,
  listContentEntries,
  projectRow,
  parseMdoc,
  SCAN_ITEM_IDS,
  SITE_CAPABILITIES
} from '../src/index'
import type { AuditContext, AuditEntry, EntryRef } from '../src/index'

const baseCtx = (scan: AuditContext['scan']): AuditContext => ({
  settings: {
    general: { title: 'T', description: 'D' },
    reading: {
      homepage: 'page/en/home',
      searchEngineVisible: true,
      feed: { enabled: false }
    }
  },
  scan,
  capabilities: SITE_CAPABILITIES,
  health: { items: {}, sections: {} }
})

// --- 1. Rubric classification -------------------------------------------------

describe('rubric instant/scan classification (#593)', () => {
  it('marks exactly the four entry-reading checks as scan; the rest are instant', () => {
    const scan = RUBRIC.filter((r) => r.needsScan === true).map((r) => r.id)
    expect(scan.sort()).toEqual([...SCAN_ITEM_IDS].sort())
    expect(scan).toHaveLength(4)
    const instant = RUBRIC.filter((r) => r.needsScan !== true)
    expect(instant).toHaveLength(RUBRIC.length - 4)
    expect(RUBRIC).toHaveLength(156)
  })

  it('every scan item has a content/config owner evaluator, not a live probe', () => {
    for (const id of SCAN_ITEM_IDS) {
      const item = RUBRIC.find((r) => r.id === id)!
      expect(item.liveProbe).not.toBe(true)
    }
  })
})

// --- 2. runInstantChecks touches no content -----------------------------------

describe('runInstantChecks (#593)', () => {
  it('resolves the instant items with no content scan (scan=null), excluding the 4 scan items', () => {
    // scan=null models a never-scanned site / a fresh mount: the instant class must
    // resolve WITHOUT any per-entry content facts (no git walk). i18n applicability is
    // the one scan-derived input among instant items and null-degrades to "applicable".
    const results = runInstantChecks(baseCtx(null))
    expect(results).toHaveLength(RUBRIC.length - 4)
    for (const id of SCAN_ITEM_IDS)
      expect(results.find((r) => r.id === id)).toBeUndefined()
    // A live config check still resolves normally.
    expect(results.find((r) => r.id === 'foundations.title')?.status).toBe(
      'pass'
    )
  })

  it('with scan=null, instant i18n stays applicable (not auto-N/A) and scan items report pending', () => {
    const audit = runAudit(baseCtx(null))
    expect(
      audit.results.find((r) => r.id === 'i18n.hreflang')?.status
    ).not.toBe('na')
    for (const id of SCAN_ITEM_IDS)
      expect(audit.results.find((r) => r.id === id)?.status).toBe('pending')
  })
})

// --- 3. Index-backed scan == direct-entry scan (parity) -----------------------

const mdoc = (fm: Record<string, unknown>, body: string): string => {
  const yaml = Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')
  return `---\n${yaml}\n---\n\n${body}\n`
}

const fixtures: { ref: EntryRef; content: string }[] = [
  {
    ref: { collection: 'page', locale: 'en', slug: 'home' },
    content: mdoc({ title: 'Home' }, 'Welcome')
  },
  {
    ref: { collection: 'post', locale: 'en', slug: 'no-title' },
    content: mdoc({ title: '' }, 'Body')
  },
  {
    ref: { collection: 'post', locale: 'en', slug: 'bad-alt' },
    content: mdoc({ title: 'Pics' }, '![](a.png)\n\n![](b.png)')
  },
  {
    ref: { collection: 'post', locale: 'fr', slug: 'deux-h1' },
    content: mdoc({ title: 'Sous-titre' }, '# Another heading')
  },
  {
    // published:false — excluded from the audited set entirely.
    ref: { collection: 'post', locale: 'de', slug: 'hidden' },
    content: mdoc({ title: '', published: false }, '# extra')
  }
]

/** The direct (old-path-equivalent) derivation: parse committed .mdoc into audit
 *  entries, dropping `published: false`, then scan them. */
const directScan = (): AuditContext['scan'] => {
  const entries: AuditEntry[] = []
  for (const { ref, content } of fixtures) {
    const { frontmatter, body } = parseMdoc(content)
    if (frontmatter['published'] === false) continue
    entries.push({
      id: `${ref.collection}/${ref.locale}/${ref.slug}`,
      data: frontmatter,
      body
    })
  }
  return auditScanFromEntries(entries)
}

/** The index-backed derivation: project rows then aggregate. */
const indexScan = (): AuditContext['scan'] => {
  const rows = listContentEntries({
    drafts: [],
    committed: fixtures,
    deploy: { deployedSha: null, changed: [] }
  }).map(projectRow)
  return selectAuditSummary(rows)
}

describe('index-backed content scan parity (#593)', () => {
  // NOTE (collection scope): the old loadAuditEntries walked only content/post +
  // content/page; the index-backed path audits EVERY committed content collection
  // (see auditFactsOf in content-index/list-entries.ts — a deliberate widening).
  // These fixtures use post + page, the only content collections today, so the
  // offender sets are identical — proving parity within the shared scope.
  it('selectAuditSummary(index rows) equals auditScanFromEntries(entries)', () => {
    expect(indexScan()).toEqual(directScan())
  })

  it('runScanChecks is identical whether fed the index or the direct scan', () => {
    const fromIndex = runScanChecks(baseCtx(indexScan()))
    const fromDirect = runScanChecks(baseCtx(directScan()))
    expect(fromIndex).toEqual(fromDirect)
  })

  it('the scan flags the real offenders and excludes published:false entries', () => {
    const scan = indexScan()!
    expect(scan.titleOffenders).toEqual(['post/en/no-title'])
    expect(scan.altOffenders).toEqual([{ ref: 'post/en/bad-alt', count: 2 }])
    expect(scan.h1Offenders).toEqual(['post/fr/deux-h1'])
    // de/hidden is published:false → absent from ids and locales.
    expect(scan.entryIds).not.toContain('post/de/hidden')
    expect(scan.locales).toEqual(['en', 'fr'])

    const results = runScanChecks(baseCtx(scan))
    const title = results.find((r) => r.id === 'foundations.entry-title')!
    expect(title.status).toBe('fail')
    expect(title.offenders?.map((o) => o.ref)).toEqual(['post/en/no-title'])
    const alt = results.find((r) => r.id === 'accessibility.image-alt')!
    expect(alt.status).toBe('fail')
    const h1 = results.find((r) => r.id === 'seo.single-h1')!
    expect(h1.status).toBe('fail')
  })

  it('homepage-resolves reads the index entry-id set', () => {
    const scan = indexScan()
    const resolves = runScanChecks(baseCtx(scan)).find(
      (r) => r.id === 'seo.homepage'
    )!
    expect(resolves.status).toBe('pass') // page/en/home exists

    const ctxMissing = baseCtx(scan)
    ctxMissing.settings.reading.homepage = 'page/en/missing'
    const missing = runScanChecks(ctxMissing).find(
      (r) => r.id === 'seo.homepage'
    )!
    expect(missing.status).toBe('fail')
  })
})

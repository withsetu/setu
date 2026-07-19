import { describe, expect, it } from 'vitest'
import { selectAuditSummary } from './audit-summary'
import type { EntryIndexRow } from './types'

const row = (over: Partial<EntryIndexRow>): EntryIndexRow => {
  const base = {
    collection: 'post',
    locale: 'en',
    slug: 'x',
    title: 'X',
    status: 'staged' as const,
    updatedAt: 0,
    hasDraft: false,
    date: null as number | null,
    tags: [] as string[],
    categories: [] as string[],
    mediaRefs: [] as string[],
    audit: {
      audited: true,
      hasTitle: true,
      imagesWithoutAlt: 0,
      h1Count: 0
    } as EntryIndexRow['audit'],
    hasFeaturedImage: false,
    hasSeoOverrides: false,
    ...over
  }
  return {
    ...base,
    key: `${base.collection}\0${base.locale}\0${base.slug}`,
    titleLower: base.title.toLowerCase()
  }
}

describe('selectAuditSummary', () => {
  it('aggregates offenders and id/locale sets over audited rows only', () => {
    const s = selectAuditSummary([
      row({ slug: 'a', audit: undefined }), // pre-v7 shape → skipped, not thrown
      row({ slug: 'clean' }),
      row({
        slug: 'no-title',
        audit: {
          audited: true,
          hasTitle: false,
          imagesWithoutAlt: 0,
          h1Count: 0
        }
      })
    ])
    expect(s.entryIds).toEqual(['post/en/clean', 'post/en/no-title'])
    expect(s.titleOffenders).toEqual(['post/en/no-title'])
  })

  it('does NOT throw on a pre-v7 cached row missing the `audit` field', () => {
    // A row cached under INDEX_VERSION < 7 (offline IDB cache) has no `audit`.
    // It must be treated as unaudited, never crash the aggregate (which would be
    // swallowed and silently downgrade the summary to empty).
    const stale = row({ slug: 'stale' })
    delete (stale as { audit?: unknown }).audit
    const good = row({ slug: 'good' })
    expect(() => selectAuditSummary([stale, good])).not.toThrow()
    expect(selectAuditSummary([stale, good]).entryIds).toEqual(['post/en/good'])
  })
})

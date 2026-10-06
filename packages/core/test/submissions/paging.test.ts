import { describe, expect, it } from 'vitest'
import type { Submission, SubmissionFilter } from '../../src/submissions/types'
import { foldForSearch } from '../../src/submissions/search'
import {
  listAllSubmissions,
  normalizeSubmissionPage
} from '../../src/submissions/paging'

describe('foldForSearch', () => {
  it('folds non-ASCII case and composes decomposed input', () => {
    expect(foldForSearch('Émile')).toBe('émile')
    expect(foldForSearch('ÉMILE')).toBe('émile')
    expect(foldForSearch('100%_\\')).toBe('100%_\\')
  })
})

describe('normalizeSubmissionPage', () => {
  it('passes through valid values', () => {
    expect(normalizeSubmissionPage({ limit: 20, offset: 40 })).toEqual({
      limit: 20,
      offset: 40
    })
    expect(normalizeSubmissionPage(undefined)).toEqual({
      limit: undefined,
      offset: 0
    })
  })
  it('clamps negative, NaN, infinite and fractional values', () => {
    expect(normalizeSubmissionPage({ limit: -1, offset: -5 })).toEqual({
      limit: 0,
      offset: 0
    })
    expect(
      normalizeSubmissionPage({ limit: Number.NaN, offset: Number.NaN })
    ).toEqual({ limit: 0, offset: 0 })
    expect(
      normalizeSubmissionPage({
        limit: Number.POSITIVE_INFINITY,
        offset: Number.POSITIVE_INFINITY
      })
    ).toEqual({ limit: undefined, offset: 0 })
    expect(normalizeSubmissionPage({ limit: 2.9, offset: 1.5 })).toEqual({
      limit: 2,
      offset: 1
    })
  })
})

describe('listAllSubmissions', () => {
  const sub = (id: string): Submission => ({
    id,
    formId: 'f',
    fields: {},
    createdAt: 0,
    read: false
  })

  it('walks every page and forwards the filter', async () => {
    const all = Array.from({ length: 7 }, (_, i) => sub(`s${i}`))
    const calls: SubmissionFilter[] = []
    const port = {
      listSubmissions: async (f: SubmissionFilter = {}) => {
        calls.push(f)
        const off = f.offset ?? 0
        return { rows: all.slice(off, off + (f.limit ?? 0)), total: all.length }
      }
    }
    const got = await listAllSubmissions(port, { formId: 'f', q: 'x' }, 3)
    expect(got.map((r) => r.id)).toEqual(all.map((r) => r.id))
    expect(calls).toEqual([
      { formId: 'f', q: 'x', limit: 3, offset: 0 },
      { formId: 'f', q: 'x', limit: 3, offset: 3 },
      { formId: 'f', q: 'x', limit: 3, offset: 6 }
    ])
  })

  it('stops on an exactly-full final page via the empty page after it', async () => {
    const all = Array.from({ length: 4 }, (_, i) => sub(`s${i}`))
    let n = 0
    const port = {
      listSubmissions: async (f: SubmissionFilter = {}) => {
        n++
        const off = f.offset ?? 0
        return { rows: all.slice(off, off + (f.limit ?? 0)), total: 4 }
      }
    }
    expect(await listAllSubmissions(port, {}, 2)).toHaveLength(4)
    expect(n).toBe(3)
  })

  it('de-duplicates a row repeated across a page boundary by a mid-walk insert', async () => {
    let list = ['a', 'b', 'c', 'd'].map(sub)
    let call = 0
    const port = {
      listSubmissions: async (f: SubmissionFilter = {}) => {
        // A new submission lands (newest-first) after the first page is read.
        if (call++ === 1) list = [sub('new'), ...list]
        const off = f.offset ?? 0
        return {
          rows: list.slice(off, off + (f.limit ?? 0)),
          total: list.length
        }
      }
    }
    const got = (await listAllSubmissions(port, {}, 2)).map((r) => r.id)
    expect(got).toEqual(['a', 'b', 'c', 'd'])
  })
})

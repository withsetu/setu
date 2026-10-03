import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDate, resolvePostDate } from '../src/lib/post-date'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('parseDate', () => {
  it('parses an ISO string', () => {
    expect(parseDate('2024-01-15')?.getFullYear()).toBe(2024)
  })
  it('returns null for invalid / missing', () => {
    expect(parseDate('not-a-date')).toBeNull()
    expect(parseDate(undefined)).toBeNull()
    expect(parseDate(null)).toBeNull()
  })
})

describe('resolvePostDate', () => {
  it('prefers a valid frontmatter date over everything', () => {
    const d = resolvePostDate({
      data: { date: '2020-05-01' },
      filePath: '/nonexistent/x.mdoc'
    })
    expect(d.getUTCFullYear()).toBe(2020)
  })
  it('falls back to file mtime when no frontmatter date and not in git', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-'))
    dirs.push(dir)
    const file = join(dir, 'p.mdoc')
    writeFileSync(file, 'hi')
    const d = resolvePostDate({ data: {}, filePath: file })
    // mtime is "recent" — within the last hour
    expect(Date.now() - d.getTime()).toBeLessThan(3_600_000)
  })

  it('honours pubDate when there is no date (#1121)', () => {
    const d = resolvePostDate({
      data: { pubDate: '2020-05-01' },
      filePath: '/nonexistent/x.mdoc'
    })
    expect(d.toISOString()).toBe('2020-05-01T00:00:00.000Z')
  })
  it('date wins over pubDate', () => {
    const d = resolvePostDate({
      data: { date: '2021-01-01', pubDate: '2020-05-01' },
      filePath: '/nonexistent/x.mdoc'
    })
    expect(d.getUTCFullYear()).toBe(2021)
  })
  it('honours a YAML-parsed pubDate (Date instance)', () => {
    const d = resolvePostDate({
      data: { pubDate: new Date('2019-03-04T00:00:00.000Z') }
    })
    expect(d.toISOString()).toBe('2019-03-04T00:00:00.000Z')
  })
  it('NEVER treats updatedAt as the published date — falls through to the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-'))
    dirs.push(dir)
    const file = join(dir, 'p.mdoc')
    writeFileSync(file, 'hi')
    const d = resolvePostDate({
      data: { updatedAt: '2001-01-01' },
      filePath: file
    })
    expect(d.getUTCFullYear()).not.toBe(2001)
    expect(Date.now() - d.getTime()).toBeLessThan(3_600_000)
  })
})

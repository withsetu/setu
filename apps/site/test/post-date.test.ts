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
})

import { describe, it, expect } from 'vitest'
import { parseMdoc, serializeMdoc, rawFrontmatterOf } from '../src/index'

/** #666: `serializeMdoc` used to re-dump whatever `load()` produced, so merely
 *  opening and saving an entry silently rewrote metadata the author never touched —
 *  on the CMS's canonical Git artifacts. The fix carries the ORIGINAL YAML text
 *  through `parseMdoc` and re-emits every unchanged key byte-for-byte. */
describe('#666 frontmatter raw-YAML retention', () => {
  const round = (raw: string, edit?: (m: Record<string, unknown>) => void) => {
    const parsed = parseMdoc(raw)
    edit?.(parsed.frontmatter)
    return serializeMdoc(parsed)
  }

  it('preserves a large integer beyond float64 precision', () => {
    const raw = '---\nbig: 12345678901234567890\n---\nbody\n'
    expect(round(raw)).toContain('big: 12345678901234567890')
  })

  it('preserves a trailing-zero decimal (1.10 stays 1.10)', () => {
    const raw = '---\nver: 1.10\n---\nbody\n'
    expect(round(raw)).toContain('ver: 1.10')
  })

  it('preserves a bare date without coercing it to a timestamp', () => {
    const raw = '---\ndate: 2024-01-01\n---\nbody\n'
    const out = round(raw)
    expect(out).toContain('date: 2024-01-01')
    expect(out).not.toContain('T00:00:00')
  })

  it('preserves quoting style on an untouched string', () => {
    const raw = '---\ntitle: "Quoted Title"\n---\nbody\n'
    expect(round(raw)).toContain('title: "Quoted Title"')
  })

  it('preserves anchors and merge keys', () => {
    const raw = '---\nbase: &a\n  x: 1\nchild:\n  <<: *a\n  y: 2\n---\nbody\n'
    const out = round(raw)
    expect(out).toContain('&a')
    expect(out).toContain('<<: *a')
  })

  it('preserves comments and key order on an untouched file', () => {
    const raw = '---\n# the headline\ntitle: Hello\nzz: 1\naa: 2\n---\nbody\n'
    const out = round(raw)
    expect(out).toContain('# the headline')
    expect(out.indexOf('zz:')).toBeLessThan(out.indexOf('aa:'))
  })

  it('is byte-identical for an untouched parse → serialize round-trip', () => {
    const raw =
      '---\n# note\ntitle: "Hi"\nbig: 12345678901234567890\ndate: 2024-01-01\ntags:\n  - a\n  - b\n---\nbody text\n'
    expect(round(raw)).toBe(raw)
  })

  it('rewrites ONLY the edited key, leaving its neighbours byte-stable', () => {
    const raw =
      '---\ntitle: "Old Title"\nbig: 12345678901234567890\ndate: 2024-01-01\n---\nbody\n'
    const out = round(raw, (m) => {
      m['title'] = 'New Title'
    })
    expect(out).toContain('big: 12345678901234567890')
    expect(out).toContain('date: 2024-01-01')
    expect(out).toContain('New Title')
    expect(out).not.toContain('Old Title')
  })

  it('adds a new key without disturbing existing ones', () => {
    const raw = '---\nbig: 12345678901234567890\n---\nbody\n'
    const out = round(raw, (m) => {
      m['added'] = true
    })
    expect(out).toContain('big: 12345678901234567890')
    expect(out).toContain('added: true')
    expect(parseMdoc(out).frontmatter['added']).toBe(true)
  })

  it('drops a deleted key and keeps the rest byte-stable', () => {
    const raw = '---\ntitle: "Keep"\ngone: 1.10\n---\nbody\n'
    const out = round(raw, (m) => {
      delete m['gone']
    })
    expect(out).toContain('title: "Keep"')
    expect(out).not.toContain('gone')
  })

  it('treats a Date and its ISO string as the same value (DB draft round-trip)', () => {
    // A draft's metadata is JSON-serialized into the DB, so a YAML Date arrives
    // back as an ISO string. That is not an author edit — the raw must survive.
    const raw = '---\ndate: 2024-01-01\ntitle: Hi\n---\nbody\n'
    const meta = JSON.parse(
      JSON.stringify(parseMdoc(raw).frontmatter)
    ) as Record<string, unknown>
    const out = serializeMdoc({
      frontmatter: meta,
      body: 'body\n',
      rawFrontmatter: rawFrontmatterOf(raw)
    })
    expect(out).toBe(raw)
  })

  it('falls back to a clean dump when no raw source is supplied', () => {
    const out = serializeMdoc({ frontmatter: { a: 1 }, body: 'b\n' })
    expect(out).toBe('---\na: 1\n---\nb\n')
  })

  it('re-emitted output always re-parses to the intended metadata', () => {
    const raw = '---\nbase: &a\n  x: 1\nchild:\n  <<: *a\n---\nbody\n'
    const out = round(raw, (m) => {
      m['extra'] = 'v'
    })
    const back = parseMdoc(out).frontmatter
    expect(back['extra']).toBe('v')
    expect(back['child']).toEqual({ x: 1 })
  })
})

import { describe, it, expect } from 'vitest'
import { diffMdoc } from '../src/editor/history-diff'

const mdoc = (fm: string, body: string) => `---\n${fm}\n---\n${body}`

describe('diffMdoc (#466): frontmatter field rows + word-level body diff', () => {
  it('reports a changed field as old → new and skips unchanged ones', () => {
    const d = diffMdoc(
      mdoc('title: Old Title\ntags:\n  - a', 'Body.'),
      mdoc('title: New Title\ntags:\n  - a', 'Body.')
    )
    expect(d.fields).toEqual([
      { key: 'title', from: 'Old Title', to: 'New Title' }
    ])
    expect(d.body).toBeNull()
    expect(d.identical).toBe(false)
  })

  it('reports added and removed fields with null on the absent side', () => {
    const d = diffMdoc(
      mdoc('title: T\nlegacy: gone', 'Body.'),
      mdoc('title: T\npublished: false', 'Body.')
    )
    expect(d.fields).toContainEqual({
      key: 'published',
      from: null,
      to: 'false'
    })
    expect(d.fields).toContainEqual({ key: 'legacy', from: 'gone', to: null })
    expect(d.fields).toHaveLength(2)
  })

  it('renders non-string values (arrays, dates) legibly, not [object Object]', () => {
    const d = diffMdoc(
      mdoc('tags:\n  - a\ndate: 2026-01-01', 'Body.'),
      mdoc('tags:\n  - a\n  - b\ndate: 2026-02-02', 'Body.')
    )
    const tags = d.fields.find((f) => f.key === 'tags')
    expect(tags?.from).toBe('a')
    expect(tags?.to).toBe('a, b')
    const date = d.fields.find((f) => f.key === 'date')
    expect(date?.from).toMatch(/^2026-01-01/)
    expect(date?.to).toMatch(/^2026-02-02/)
  })

  it('word-diffs the body: unchanged, removed, and added segments', () => {
    const d = diffMdoc(
      mdoc('title: T', 'The quick brown fox.'),
      mdoc('title: T', 'The slow brown fox jumps.')
    )
    expect(d.fields).toEqual([])
    expect(d.body).not.toBeNull()
    const removed = d.body!.filter((s) => s.removed).map((s) => s.value.trim())
    const added = d.body!.filter((s) => s.added).map((s) => s.value.trim())
    expect(removed.join(' ')).toContain('quick')
    expect(added.join(' ')).toContain('slow')
    expect(added.join(' ')).toContain('jumps')
    // Round-trip: concatenating unchanged+added segments reproduces the NEW body.
    expect(
      d
        .body!.filter((s) => !s.removed)
        .map((s) => s.value)
        .join('')
    ).toBe('The slow brown fox jumps.')
  })

  it('identical contents → identical:true, no fields, null body', () => {
    const raw = mdoc('title: Same', 'Same body.')
    const d = diffMdoc(raw, raw)
    expect(d).toEqual({ fields: [], body: null, identical: true })
  })

  it('body-only files (no frontmatter fence) diff as pure body', () => {
    const d = diffMdoc('plain one', 'plain two')
    expect(d.fields).toEqual([])
    expect(d.body!.some((s) => s.added && s.value.includes('two'))).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { slashBlocks } from '../src/editor/blocks'

describe('slashBlocks', () => {
  it('offers H2/H3/H4 (not H1) plus the structural blocks, divider, and the callout', () => {
    const titles = slashBlocks().map((b) => b.title)
    expect(titles).toContain('Heading 2')
    expect(titles).toContain('Heading 3')
    expect(titles).toContain('Heading 4')
    expect(titles).not.toContain('Heading 1')
    expect(titles).toContain('Text')
    expect(titles).toContain('Bullet list')
    expect(titles).toContain('Numbered list')
    expect(titles).toContain('Quote')
    expect(titles).toContain('Code block')
    expect(titles).toContain('Divider')
    expect(titles).toContain('Checklist')
    expect(titles).toContain('Table')
    expect(titles.some((t) => /callout/i.test(t))).toBe(true)
  })
})

describe('slashBlocks — folder blocks route to the right node', () => {
  it('offers the dependency-free Notice folder block', () => {
    expect(slashBlocks().map((b) => b.title)).toContain('Notice')
  })
})

describe('slashBlocks — hero deduplication', () => {
  it('contains exactly one entry titled "Hero"', () => {
    const heroEntries = slashBlocks().filter((b) => b.title === 'Hero')
    expect(heroEntries).toHaveLength(1)
  })

  it('hero entry inserts a heroBlock node (not a setuBlock)', () => {
    const heroEntry = slashBlocks().find((b) => b.title === 'Hero')
    expect(heroEntry).toBeDefined()
    if (!heroEntry) return

    const insertedContent: unknown[] = []
    const chain = {
      focus: () => chain,
      deleteRange: (_r: unknown) => chain,
      insertContent: (content: unknown) => {
        insertedContent.push(content)
        return chain
      },
      run: () => true
    }
    const mockEditor = { chain: () => chain } as any
    heroEntry.run(mockEditor, { from: 0, to: 0 })

    expect(insertedContent).toHaveLength(1)
    expect((insertedContent[0] as { type: string }).type).toBe('heroBlock')
  })
})

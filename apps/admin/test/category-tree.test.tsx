import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { CategoryNode } from '@setu/core'
import {
  CategoryTree,
  buildReparentIndex
} from '../src/screens/taxonomies/CategoryTree'

// Radix Select calls scrollIntoView / pointer-capture APIs jsdom lacks — stub them
// so the "Move to" picker can open and select in these tests.
beforeAll(() => {
  const proto = window.HTMLElement.prototype
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {}
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {}
})

const node = (over: Partial<CategoryNode> = {}): CategoryNode => ({
  slug: 'news',
  name: 'News',
  parent: null,
  children: [],
  depth: 0,
  ...over
})

const noop = () => {}

/** Flatten helper: a chain root→c1→…→c(n-1), each the child of the previous. */
function chain(n: number): CategoryNode[] {
  return Array.from({ length: n }, (_, i) => ({
    slug: `c${i}`,
    name: `C${i}`,
    parent: i === 0 ? null : `c${i - 1}`,
    children: [],
    depth: i
  }))
}

// #592: the reparent index is what replaces the O(n³) hot path — descendant sets
// (invalid reparent targets) are computed ONCE per rows change and looked up O(1)
// per row, instead of recomputing an O(n²) fixpoint inside the row map.
describe('buildReparentIndex (#592)', () => {
  it('bans a node itself and all of its descendants (cycle-forming targets)', () => {
    // a ─ b ─ d
    //   └ c
    const rows: CategoryNode[] = [
      node({ slug: 'a', name: 'A', parent: null, depth: 0 }),
      node({ slug: 'b', name: 'B', parent: 'a', depth: 1 }),
      node({ slug: 'd', name: 'D', parent: 'b', depth: 2 }),
      node({ slug: 'c', name: 'C', parent: 'a', depth: 1 })
    ]
    const { bannedBySlug } = buildReparentIndex(rows)
    expect([...bannedBySlug.get('a')!].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect([...bannedBySlug.get('b')!].sort()).toEqual(['b', 'd'])
    expect([...bannedBySlug.get('d')!].sort()).toEqual(['d'])
    expect([...bannedBySlug.get('c')!].sort()).toEqual(['c'])
  })

  it('maps every slug to its display name', () => {
    const rows: CategoryNode[] = [
      node({ slug: 'a', name: 'Alpha', parent: null }),
      node({ slug: 'b', name: 'Beta', parent: 'a' })
    ]
    const { nameBySlug } = buildReparentIndex(rows)
    expect(nameBySlug.get('a')).toBe('Alpha')
    expect(nameBySlug.get('b')).toBe('Beta')
  })

  it('handles a deep chain without blowing up (root bans the whole chain)', () => {
    const rows = chain(150)
    const { bannedBySlug } = buildReparentIndex(rows)
    // The root's banned set is the entire chain; a leaf bans only itself.
    expect(bannedBySlug.get('c0')!.size).toBe(150)
    expect([...bannedBySlug.get('c149')!]).toEqual(['c149'])
    // Midpoint bans itself + everything below it.
    expect(bannedBySlug.get('c75')!.size).toBe(150 - 75)
  })
})

describe('CategoryTree slug cell (#554)', () => {
  // Category slugs derive from free-text names — a very long slug must truncate inside its
  // column (full slug on hover) instead of stretching the table past the viewport.
  it('truncates a long slug with the full slug on hover', () => {
    const longSlug = 'adelaide-'.repeat(20).concat('adelaide')
    render(
      <CategoryTree
        rows={[node({ slug: longSlug, name: 'Adelaide' })]}
        counts={{}}
        onRename={noop}
        onReparent={noop}
        onDelete={noop}
      />
    )
    const el = screen.getByTitle(`/${longSlug}`)
    expect(el).toHaveTextContent(`/${longSlug}`)
    expect(el.className).toContain('truncate')
  })
})

describe('CategoryTree "Move to" reparent picker (#592)', () => {
  // a ─ b ─ d
  //   └ c
  const tree: CategoryNode[] = [
    node({ slug: 'a', name: 'A', parent: null, depth: 0 }),
    node({ slug: 'b', name: 'B', parent: 'a', depth: 1 }),
    node({ slug: 'd', name: 'D', parent: 'b', depth: 2 }),
    node({ slug: 'c', name: 'C', parent: 'a', depth: 1 })
  ]

  function renderTree(onReparent = noop) {
    return render(
      <CategoryTree
        rows={tree}
        counts={{}}
        onRename={noop}
        onReparent={onReparent}
        onDelete={noop}
      />
    )
  }

  function openMove(name: string): HTMLElement {
    const trigger = screen.getByRole('combobox', { name: `Move ${name}` })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: ' ', code: 'Space' })
    return trigger
  }

  it('offers valid targets and excludes the node itself and its descendants', async () => {
    renderTree()
    openMove('B') // banned = {b, d}; valid = a, c, + Top level
    const listbox = await screen.findByRole('listbox')
    const optionTexts = within(listbox)
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(optionTexts).toContain('Top level')
    expect(optionTexts).toContain('A')
    expect(optionTexts).toContain('C')
    expect(optionTexts).not.toContain('B')
    expect(optionTexts).not.toContain('D')
  })

  it('calls onReparent(slug, target) when a new parent is chosen', async () => {
    const onReparent = vi.fn()
    renderTree(onReparent)
    openMove('B')
    const listbox = await screen.findByRole('listbox')
    fireEvent.click(within(listbox).getByRole('option', { name: 'C' }))
    expect(onReparent).toHaveBeenCalledWith('b', 'c')
  })

  it('calls onReparent(slug, null) when "Top level" is chosen', async () => {
    const onReparent = vi.fn()
    renderTree(onReparent)
    openMove('D') // currently under b
    const listbox = await screen.findByRole('listbox')
    fireEvent.click(within(listbox).getByRole('option', { name: 'Top level' }))
    expect(onReparent).toHaveBeenCalledWith('d', null)
  })

  it('shows the current parent name on a closed row trigger (lazy branch keeps selection)', () => {
    renderTree()
    // Row "B" sits under "A": its closed trigger must read "A", proving the
    // lazy closed state still renders the *selected* item (Radix reads the
    // mounted item to label the trigger).
    const trigger = screen.getByRole('combobox', { name: 'Move B' })
    expect(trigger).toHaveTextContent('A')
  })

  // #592 perf-shape: at ~150 categories the old code eagerly mounted a full
  // ~150-item Select for every row (≈22k items) AND recomputed an O(n²) descendant
  // fixpoint per row (O(n³)). The tree must now render at scale with NO Select open
  // and no listbox in the document; opening exactly one row builds exactly one list.
  it('renders a large tree with no open lists, then opens one row on demand', async () => {
    const big = chain(150)
    render(
      <CategoryTree
        rows={big}
        counts={{}}
        onRename={noop}
        onReparent={noop}
        onDelete={noop}
      />
    )
    // All 150 rows present, nothing expanded.
    expect(screen.getAllByRole('combobox')).toHaveLength(150)
    expect(screen.queryByRole('listbox')).toBeNull()
    // Open just the leaf row → exactly one listbox appears.
    const leaf = screen.getByRole('combobox', { name: 'Move C149' })
    leaf.focus()
    fireEvent.keyDown(leaf, { key: ' ', code: 'Space' })
    await screen.findByRole('listbox')
    expect(screen.getAllByRole('listbox')).toHaveLength(1)
  })
})

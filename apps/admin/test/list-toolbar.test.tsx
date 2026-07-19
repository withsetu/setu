import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Radix Select calls scrollIntoView on the active item when it opens — stub it
// for jsdom (same pattern as user-menu.test.tsx / DateField.test.tsx).
if (
  typeof window !== 'undefined' &&
  !window.HTMLElement.prototype.scrollIntoView
) {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}

// TagFilter depends on IndexProvider/ServicesProvider which are heavy context deps.
// Mock it at the module level so ListToolbar's own behaviour can be tested in isolation.
vi.mock('../src/screens/TagFilter', () => ({
  TagFilter: ({
    value,
    onChange
  }: {
    value: string
    onChange: (t: string) => void
  }) => (
    <input
      aria-label="Filter by tag"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}))

import { ListToolbar } from '../src/screens/content-list/ListToolbar'

const base = {
  title: 'Posts',
  search: '',
  onSearch: () => {},
  status: '',
  onStatus: () => {},
  category: '',
  onCategory: () => {},
  catRows: [{ slug: 'news', name: 'News', depth: 0 }],
  tag: '',
  onTag: () => {},
  featured: '',
  onFeatured: () => {},
  seo: '',
  onSeo: () => {},
  hasFilters: false,
  onClear: () => {},
  columnsMenu: <button>Columns</button>
}

describe('ListToolbar', () => {
  it('search input calls onSearch', () => {
    const onSearch = vi.fn()
    render(<ListToolbar {...base} onSearch={onSearch} />)
    fireEvent.change(screen.getByPlaceholderText(/search posts/i), {
      target: { value: 'hi' }
    })
    expect(onSearch).toHaveBeenCalledWith('hi')
  })
  it('renders the featured-image filter and reflects its value (#576)', () => {
    const { rerender } = render(<ListToolbar {...base} />)
    const trigger = screen.getByLabelText('Filter by featured image')
    expect(trigger).toHaveTextContent('Featured: all')
    rerender(<ListToolbar {...base} featured="has" />)
    expect(screen.getByLabelText('Filter by featured image')).toHaveTextContent(
      'Has featured image'
    )
    rerender(<ListToolbar {...base} featured="none" />)
    expect(screen.getByLabelText('Filter by featured image')).toHaveTextContent(
      'No featured image'
    )
  })
  it('renders the SEO filter and reflects its value (#577)', () => {
    const { rerender } = render(<ListToolbar {...base} />)
    expect(screen.getByLabelText('Filter by SEO')).toHaveTextContent('SEO: all')
    rerender(<ListToolbar {...base} seo="custom" />)
    expect(screen.getByLabelText('Filter by SEO')).toHaveTextContent(
      'Custom SEO'
    )
    rerender(<ListToolbar {...base} seo="none" />)
    expect(screen.getByLabelText('Filter by SEO')).toHaveTextContent(
      'No custom SEO'
    )
  })
  // #598 UAT: the menu had grown to seven options mixing unions with exact
  // lifecycle states, in wording that didn't match the dashboard tiles linking
  // into it. Four entries now: All status + Live / Staged / Drafts.
  it('offers exactly four status options (#598)', () => {
    render(<ListToolbar {...base} />)
    fireEvent.click(screen.getByLabelText('Filter by status'))
    const options = screen
      .getAllByRole('option')
      .map((o) => o.textContent ?? '')
    expect(options).toHaveLength(4)
    expect(options[0]).toContain('All status')
    expect(options[1]).toContain('Live')
    expect(options[2]).toContain('Staged')
    expect(options[3]).toContain('Drafts')
  })

  // Each option carries the same hint its dashboard tile shows, so the two
  // surfaces read as one vocabulary.
  it('shows the tile hint under each status option (#598)', () => {
    render(<ListToolbar {...base} />)
    fireEvent.click(screen.getByLabelText('Filter by status'))
    const menu = screen.getAllByRole('option').map((o) => o.textContent ?? '')
    expect(menu.join('|')).toContain('On the site')
    expect(menu.join('|')).toContain('Pending deploy')
    expect(menu.join('|')).toContain('Not published')
  })

  it('drops the union-vs-exact-state options from the menu (#598)', () => {
    render(<ListToolbar {...base} />)
    fireEvent.click(screen.getByLabelText('Filter by status'))
    const menu = screen.getAllByRole('option').map((o) => o.textContent ?? '')
    expect(menu.join('|')).not.toContain('staged + live')
    expect(menu.join('|')).not.toContain('draft + unpublished')
    expect(menu.some((t) => t.trim() === 'Draft')).toBe(false)
    expect(menu.some((t) => t.trim() === 'Unpublished')).toBe(false)
  })

  it('reflects a menu status compactly in the trigger', () => {
    const { rerender } = render(<ListToolbar {...base} />)
    expect(screen.getByLabelText('Filter by status')).toHaveTextContent(
      'All status'
    )
    rerender(<ListToolbar {...base} status="staged" />)
    expect(screen.getByLabelText('Filter by status')).toHaveTextContent(
      'Staged'
    )
    rerender(<ListToolbar {...base} status="live" />)
    expect(screen.getByLabelText('Filter by status')).toHaveTextContent('Live')
    rerender(<ListToolbar {...base} status="not-published" />)
    expect(screen.getByLabelText('Filter by status')).toHaveTextContent(
      'Drafts'
    )
  })

  // `published`, `draft` and `unpublished` stay valid `?status=` values (#579
  // deep links, the index port contract) even though they left the menu. The
  // control must NAME the active filter — reading "All status" over a filtered
  // list is the exact dishonesty #579 fixed.
  it.each([
    ['published', 'Published'],
    ['draft', 'Draft'],
    ['unpublished', 'Unpublished']
  ])('names off-menu status %s as %s rather than "All status"', (v, shown) => {
    render(<ListToolbar {...base} status={v} />)
    const trigger = screen.getByLabelText('Filter by status')
    expect(trigger).toHaveTextContent(shown)
    expect(trigger).not.toHaveTextContent('All status')
  })

  it('adds the active off-menu status as its own checked option (#598)', () => {
    render(<ListToolbar {...base} status="published" />)
    fireEvent.click(screen.getByLabelText('Filter by status'))
    const options = screen
      .getAllByRole('option')
      .map((o) => o.textContent ?? '')
    // 4 menu entries + the off-menu value it arrived with.
    expect(options).toHaveLength(5)
    expect(options.some((t) => t.trim() === 'Published')).toBe(true)
    expect(screen.getByRole('option', { name: 'Published' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('does not add an off-menu option when a listed status is active', () => {
    render(<ListToolbar {...base} status="live" />)
    fireEvent.click(screen.getByLabelText('Filter by status'))
    expect(screen.getAllByRole('option')).toHaveLength(4)
  })

  it('shows Clear only when filters are active', () => {
    const { rerender } = render(<ListToolbar {...base} hasFilters={false} />)
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull()
    rerender(<ListToolbar {...base} hasFilters />)
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
  })
})

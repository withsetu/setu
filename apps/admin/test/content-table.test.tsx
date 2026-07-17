import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ContentRow } from '@setu/core'
import { ContentTable } from '../src/screens/content-list/ContentTable'

const allCols = {
  status: true,
  tags: true,
  categories: true,
  featured: true,
  updated: true,
  locale: true
}
function row(o: Partial<ContentRow> = {}): ContentRow {
  return {
    ref: { collection: 'post', locale: 'en', slug: 'hi' },
    title: 'Hi',
    locale: 'en',
    lifecycle: { state: 'draft' },
    updatedAt: Date.now(),
    hasDraft: true,
    date: null,
    tags: ['a', 'b', 'c'],
    categories: ['news'],
    mediaRefs: [],
    hasFeaturedImage: false,
    ...o
  }
}
const base = {
  gen: 0,
  visible: allCols,
  showLocale: true,
  categoryName: (s: string) => s.toUpperCase(),
  selected: new Set<string>(),
  allSelected: false,
  onToggleRow: () => {},
  onToggleAll: () => {},
  sort: { key: 'updatedAt' as const, dir: 'desc' as const },
  onSort: () => {}
}
const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('ContentTable', () => {
  it('renders title link, status badge, tag chips (2 + overflow), category name', () => {
    wrap(<ContentTable {...base} rows={[row()]} />)
    expect(screen.getByRole('link', { name: 'Hi' })).toHaveAttribute(
      'href',
      '/edit/post/en/hi'
    )
    expect(screen.getByText('Draft').className).toContain('bg-warning')
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument() // 3 tags → 2 chips + "+1"
    expect(screen.getByText('NEWS')).toBeInTheDocument() // category slug → name
  })
  it('shows an em dash for empty tags/categories', () => {
    wrap(<ContentTable {...base} rows={[row({ tags: [], categories: [] })]} />)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })
  it('hides columns that are not visible', () => {
    wrap(
      <ContentTable
        {...base}
        visible={{ ...allCols, tags: false }}
        rows={[row()]}
      />
    )
    expect(screen.queryByText('a')).toBeNull()
  })
  it('renders pending suffix alongside the status badge when lifecycle.pending is set', () => {
    wrap(
      <ContentTable
        {...base}
        rows={[row({ lifecycle: { state: 'live', pending: 'edited' } })]}
      />
    )
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText(/· edited/)).toBeInTheDocument()
  })
  // #554: a ~285-char title used to render in an unbounded whitespace-nowrap cell, stretching the
  // table past the viewport. Contract: the title cell absorbs the leftover width but never more
  // (w-full + max-w-0 on the td is what lets the inner `truncate` actually engage in an
  // auto-layout table), and the full text stays reachable via the title attribute.
  describe('long-title overflow (#554)', () => {
    const LONG_TITLE = 'Adelaide, '.repeat(28).concat('Adelaide').slice(0, 285)
    const LONG_SLUG = 'adelaide-'.repeat(20).concat('adelaide')

    it('bounds the title cell and truncates the title link, full title on hover', () => {
      wrap(
        <ContentTable
          {...base}
          rows={[
            row({
              title: LONG_TITLE,
              ref: { collection: 'post', locale: 'en', slug: LONG_SLUG }
            })
          ]}
        />
      )
      const link = screen.getByTitle(LONG_TITLE)
      expect(link).toHaveTextContent(LONG_TITLE)
      expect(link.className).toContain('truncate')
      expect(link.className).toContain('min-w-0')
      const cell = link.closest('td')
      expect(cell).not.toBeNull()
      // w-full + max-w-0 is the pair that makes truncation possible at all in an
      // auto-layout table: without a max-width the cell just grows to fit the text.
      expect(cell!.className).toContain('w-full')
      expect(cell!.className).toContain('max-w-0')
    })

    it('truncates the slug line under the title, full slug on hover', () => {
      wrap(
        <ContentTable
          {...base}
          rows={[
            row({
              title: LONG_TITLE,
              ref: { collection: 'post', locale: 'en', slug: LONG_SLUG }
            })
          ]}
        />
      )
      const slugEl = screen.getByTitle(`/${LONG_SLUG}`)
      expect(slugEl).toHaveTextContent(`/${LONG_SLUG}`)
      expect(slugEl.className).toContain('truncate')
    })
  })

  describe('featured-image indicator column (#576)', () => {
    it('shows a tick with an accessible label when the row has a featured image', () => {
      wrap(
        <ContentTable
          {...base}
          rows={[
            row({ hasFeaturedImage: true, featuredImage: '/media/a.webp' })
          ]}
        />
      )
      expect(screen.getByLabelText('Has featured image')).toBeInTheDocument()
      expect(screen.queryByLabelText('No featured image')).toBeNull()
    })
    it('shows a muted dash with an accessible label when it has none', () => {
      wrap(<ContentTable {...base} rows={[row()]} />)
      expect(screen.getByLabelText('No featured image')).toBeInTheDocument()
    })
    it('hides the column when toggled off', () => {
      wrap(
        <ContentTable
          {...base}
          visible={{ ...allCols, featured: false }}
          rows={[row({ hasFeaturedImage: true })]}
        />
      )
      expect(screen.queryByLabelText('Has featured image')).toBeNull()
    })
  })

  it('per-row checkbox + sort header fire callbacks', () => {
    const onToggleRow = vi.fn()
    const onSort = vi.fn()
    wrap(
      <ContentTable
        {...base}
        rows={[row()]}
        onToggleRow={onToggleRow}
        onSort={onSort}
      />
    )
    fireEvent.click(screen.getByLabelText('Select Hi'))
    expect(onToggleRow).toHaveBeenCalledWith('post/en/hi')
    fireEvent.click(screen.getByRole('button', { name: /Title/ }))
    expect(onSort).toHaveBeenCalledWith('title')
  })
})

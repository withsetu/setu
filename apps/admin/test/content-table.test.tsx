import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ContentRow } from '@setu/core'
import { ContentTable } from '../src/screens/content-list/ContentTable'

const allCols = { status: true, tags: true, categories: true, updated: true, locale: true }
function row(o: Partial<ContentRow> = {}): ContentRow {
  return { ref: { collection: 'post', locale: 'en', slug: 'hi' }, title: 'Hi', locale: 'en',
    lifecycle: { state: 'draft' }, updatedAt: Date.now(), hasDraft: true,
    tags: ['a', 'b', 'c'], categories: ['news'], mediaRefs: [], ...o }
}
const base = {
  gen: 0, visible: allCols, showLocale: true, categoryName: (s: string) => s.toUpperCase(),
  selected: new Set<string>(), allSelected: false, onToggleRow: () => {}, onToggleAll: () => {},
  sort: { key: 'updatedAt' as const, dir: 'desc' as const }, onSort: () => {},
}
const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('ContentTable', () => {
  it('renders title link, status badge, tag chips (2 + overflow), category name', () => {
    wrap(<ContentTable {...base} rows={[row()]} />)
    expect(screen.getByRole('link', { name: 'Hi' })).toHaveAttribute('href', '/edit/post/en/hi')
    expect(screen.getByText('Draft').className).toContain('bg-warning')
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()      // 3 tags → 2 chips + "+1"
    expect(screen.getByText('NEWS')).toBeInTheDocument()     // category slug → name
  })
  it('shows an em dash for empty tags/categories', () => {
    wrap(<ContentTable {...base} rows={[row({ tags: [], categories: [] })]} />)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })
  it('hides columns that are not visible', () => {
    wrap(<ContentTable {...base} visible={{ ...allCols, tags: false }} rows={[row()]} />)
    expect(screen.queryByText('a')).toBeNull()
  })
  it('renders pending suffix alongside the status badge when lifecycle.pending is set', () => {
    wrap(<ContentTable {...base} rows={[row({ lifecycle: { state: 'live', pending: 'edited' } })]} />)
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText(/· edited/)).toBeInTheDocument()
  })
  it('per-row checkbox + sort header fire callbacks', () => {
    const onToggleRow = vi.fn(); const onSort = vi.fn()
    wrap(<ContentTable {...base} rows={[row()]} onToggleRow={onToggleRow} onSort={onSort} />)
    fireEvent.click(screen.getByLabelText('Select Hi'))
    expect(onToggleRow).toHaveBeenCalledWith('post/en/hi')
    fireEvent.click(screen.getByRole('button', { name: /Title/ }))
    expect(onSort).toHaveBeenCalledWith('title')
  })
})

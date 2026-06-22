import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// TagFilter depends on IndexProvider/ServicesProvider which are heavy context deps.
// Mock it at the module level so ListToolbar's own behaviour can be tested in isolation.
vi.mock('../src/screens/TagFilter', () => ({
  TagFilter: ({ value, onChange }: { value: string; onChange: (t: string) => void }) =>
    <input aria-label="Filter by tag" value={value} onChange={(e) => onChange(e.target.value)} />,
}))

import { ListToolbar } from '../src/screens/content-list/ListToolbar'

const base = {
  title: 'Posts', search: '', onSearch: () => {}, status: '', onStatus: () => {},
  category: '', onCategory: () => {}, catRows: [{ slug: 'news', name: 'News', depth: 0 }],
  tag: '', onTag: () => {}, hasFilters: false, onClear: () => {}, columnsMenu: <button>Columns</button>,
}

describe('ListToolbar', () => {
  it('search input calls onSearch', () => {
    const onSearch = vi.fn()
    render(<ListToolbar {...base} onSearch={onSearch} />)
    fireEvent.change(screen.getByPlaceholderText(/search posts/i), { target: { value: 'hi' } })
    expect(onSearch).toHaveBeenCalledWith('hi')
  })
  it('shows Clear only when filters are active', () => {
    const { rerender } = render(<ListToolbar {...base} hasFilters={false} />)
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull()
    rerender(<ListToolbar {...base} hasFilters />)
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
  })
})

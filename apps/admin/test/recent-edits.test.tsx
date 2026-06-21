import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ContentRow } from '@setu/core'
import { RecentEdits } from '../src/dashboard/widgets/RecentEdits'

const row: ContentRow = {
  ref: { collection: 'post', locale: 'en', slug: 'p1' },
  title: 'First Post',
  locale: 'en',
  updatedAt: 0,
  lifecycle: { state: 'draft' },
  hasDraft: true,
  tags: [],
  categories: [],
  mediaRefs: [],
}

describe('RecentEdits', () => {
  it('links each entry to its editor route', () => {
    render(<MemoryRouter><RecentEdits rows={[row]} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /first post/i })).toHaveAttribute('href', '/edit/post/en/p1')
  })

  it('shows an empty state when there are no entries', () => {
    render(<MemoryRouter><RecentEdits rows={[]} /></MemoryRouter>)
    expect(screen.getByText(/nothing edited yet/i)).toBeInTheDocument()
  })
})

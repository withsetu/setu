import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ContentRow } from '@setu/core'
import { ResumeEditing } from '../src/dashboard/widgets/ResumeEditing'

function row(over: Partial<ContentRow> = {}): ContentRow {
  return {
    ref: { collection: 'post', locale: 'en', slug: 'hello' },
    title: 'Hello world',
    locale: 'en',
    lifecycle: { state: 'draft' },
    updatedAt: Date.now(),
    hasDraft: true,
    date: null,
    tags: [],
    categories: [],
    mediaRefs: [],
    ...over
  }
}
const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('ResumeEditing', () => {
  it('renders a row with title, collection and a status badge', () => {
    wrap(<ResumeEditing rows={[row()]} />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(screen.getByText('post')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })
  it('links each row to its editor route', () => {
    wrap(<ResumeEditing rows={[row()]} />)
    expect(screen.getByRole('link', { name: /Hello world/ })).toHaveAttribute(
      'href',
      '/edit/post/en/hello'
    )
  })
  it('maps live state to the success badge', () => {
    wrap(<ResumeEditing rows={[row({ lifecycle: { state: 'live' } })]} />)
    expect(screen.getByText('Live').className).toContain('bg-success')
  })
  it('shows an empty state with a create link when there are no rows', () => {
    wrap(<ResumeEditing rows={[]} />)
    expect(screen.getByText(/No edits yet/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /create your first post/ })
    ).toHaveAttribute('href', '/edit/post/en/new')
  })
})

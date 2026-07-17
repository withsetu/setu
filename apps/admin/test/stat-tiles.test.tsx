import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StatTiles } from '../src/dashboard/widgets/StatTiles'

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('StatTiles', () => {
  it('renders the four counts', () => {
    wrap(<StatTiles posts={128} pages={14} published={9} drafts={5} />)
    expect(screen.getByText('Posts').previousSibling).toHaveTextContent('128')
    expect(screen.getByText('Published').previousSibling).toHaveTextContent('9')
  })
  it('links Drafts to the filtered list', () => {
    wrap(<StatTiles posts={1} pages={1} published={1} drafts={5} />)
    expect(screen.getByRole('link', { name: /Drafts/ })).toHaveAttribute(
      'href',
      '/posts?status=draft'
    )
  })
  // #572: every stat is a link to its list view. There is no `published` status in the
  // list filter (LifecycleState = draft/staged/live/unpublished; "published" on the
  // dashboard = staged + live), so Published links to the plain posts list.
  it('links Posts, Pages and Published to their list views (#572)', () => {
    wrap(<StatTiles posts={128} pages={14} published={9} drafts={5} />)
    expect(screen.getByRole('link', { name: /Posts/ })).toHaveAttribute(
      'href',
      '/posts'
    )
    expect(screen.getByRole('link', { name: /Pages/ })).toHaveAttribute(
      'href',
      '/pages'
    )
    expect(screen.getByRole('link', { name: /Published/ })).toHaveAttribute(
      'href',
      '/posts'
    )
  })
  // #572: while entries load, the card shell paints with skeleton placeholders for the
  // numbers — real labels, no zero flash, nothing clickable yet.
  it('renders skeleton placeholders instead of numbers while loading (#572)', () => {
    const { container } = wrap(
      <StatTiles loading posts={0} pages={0} published={0} drafts={0} />
    )
    expect(screen.getByText('At a glance')).toBeInTheDocument()
    expect(screen.getByText('Posts')).toBeInTheDocument()
    expect(screen.getByText('Drafts')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4)
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

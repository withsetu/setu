import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StatTiles } from '../src/dashboard/widgets/StatTiles'

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

const props = { posts: 128, pages: 14, live: 9, staged: 3, drafts: 5 }

describe('StatTiles', () => {
  it('renders the five counts', () => {
    wrap(<StatTiles {...props} />)
    expect(screen.getByText('Posts').previousSibling).toHaveTextContent('128')
    expect(screen.getByText('Pages').previousSibling).toHaveTextContent('14')
    expect(screen.getByText('Live').previousSibling).toHaveTextContent('9')
    expect(screen.getByText('Staged').previousSibling).toHaveTextContent('3')
    expect(screen.getByText('Drafts').previousSibling).toHaveTextContent('5')
  })

  // #598: "Published" lumped staged + live, which reads as "on the site" when a
  // staged entry is committed-but-not-deployed. The tile set names both states.
  it('has no "Published" tile — Live and Staged replace it (#598)', () => {
    wrap(<StatTiles {...props} />)
    expect(screen.queryByText('Published')).toBeNull()
  })

  // Card #7 (saved ≠ live): the Staged tile must say out loud that those entries
  // are not on the site yet, not leave the user to infer it from the word.
  it('labels Staged as pending deploy (#598)', () => {
    wrap(<StatTiles {...props} />)
    expect(screen.getByText(/pending deploy/i)).toBeInTheDocument()
  })

  // #579 + #598: every tile deep-links to the list filtered to exactly what it
  // counted — no tile lands on the same unfiltered view as another.
  it('deep-links each tile to its matching filtered list (#579)', () => {
    wrap(<StatTiles {...props} />)
    const href = (name: RegExp) =>
      screen.getByRole('link', { name }).getAttribute('href')
    expect(href(/Posts/)).toBe('/posts')
    expect(href(/Pages/)).toBe('/pages')
    expect(href(/Live/)).toBe('/posts?status=live')
    expect(href(/Staged/)).toBe('/posts?status=staged')
    expect(href(/Drafts/)).toBe('/posts?status=draft')
  })

  it('gives every tile a distinct destination (no redundant links, #598)', () => {
    wrap(<StatTiles {...props} />)
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  // #572: while entries load, the card shell paints with skeleton placeholders for the
  // numbers — real labels, no zero flash, nothing clickable yet.
  it('renders skeleton placeholders instead of numbers while loading (#572)', () => {
    const { container } = wrap(
      <StatTiles loading posts={0} pages={0} live={0} staged={0} drafts={0} />
    )
    expect(screen.getByText('At a glance')).toBeInTheDocument()
    expect(screen.getByText('Posts')).toBeInTheDocument()
    expect(screen.getByText('Drafts')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(5)
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

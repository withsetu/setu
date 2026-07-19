import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { projectRow, runQuery, selectIndexStats } from '@setu/core'
import type { ContentRow, IndexQuery } from '@setu/core'
import { isIndexStatusFilter } from '@setu/core'
import { StatTiles } from '../src/dashboard/widgets/StatTiles'
import { STATUS_FILTER_MENU } from '../src/lib/status-filter-vocab'
import { dashboardCountsFromStats } from '../src/dashboard/entries'

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
  it('deep-links each tile to its matching filtered list (#579, #604)', () => {
    wrap(<StatTiles {...props} />)
    const href = (name: RegExp) =>
      screen.getByRole('link', { name }).getAttribute('href')
    expect(href(/Posts/)).toBe('/posts')
    expect(href(/Pages/)).toBe('/pages')
    // The status tiles count post + page, so they open the cross-collection
    // list, not /posts — see the tile==destination test below (#604).
    expect(href(/Live/)).toBe('/content?status=live')
    expect(href(/Staged/)).toBe('/content?status=staged')
    expect(href(/Drafts/)).toBe('/content?status=not-published')
  })

  // #598 UAT: "Not on the site" is equally true of a STAGED entry, so it never
  // distinguished this tile. What separates them is intent — Live and Staged are
  // both meant to be public; these are not. The hint also has to match the menu
  // option the tile links to, which now reads "Drafts / Not published".
  it('labels Drafts as not published, not "not on the site" (#598)', () => {
    wrap(<StatTiles {...props} />)
    expect(screen.getByText('Not published')).toBeInTheDocument()
    expect(screen.queryByText('Not on the site')).toBeNull()
  })

  // The Live/Staged hints are location-true because those tiles ARE separated by
  // deploy state; only the Drafts hint had to change.
  it('keeps the Live and Staged hints', () => {
    wrap(<StatTiles {...props} />)
    expect(screen.getByText('On the site')).toBeInTheDocument()
    expect(screen.getByText('Pending deploy')).toBeInTheDocument()
  })

  // The tiles and the status filter render from one list, so a label can't be
  // changed on one surface and left stale on the other (#598 UAT).
  it('renders its labels and hints from the shared status vocabulary', () => {
    wrap(<StatTiles {...props} />)
    for (const e of STATUS_FILTER_MENU) {
      expect(screen.getByText(e.label)).toBeInTheDocument()
      expect(screen.getByText(e.hint)).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: new RegExp(e.label) })
      ).toHaveAttribute('href', `/content?status=${e.value}`)
    }
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

/** #604 regression guard, and the reason this file imports the real query
 *  engine: a tile whose number can't be reproduced by the list it opens is a
 *  bug. UAT hit exactly that — Staged said 19, the list showed 5, because the
 *  tiles count post + page and /posts can only show posts.
 *
 *  Rather than eyeball the hrefs, this drives them: build a fixture corpus, take
 *  the tile numbers from the SAME function the dashboard uses, then parse each
 *  tile's href back into an IndexQuery and run it through core's `runQuery` —
 *  the one implementation every adapter delegates to. Both sides move together
 *  or the test fails. */
describe('StatTiles — the number you click equals the list you land on (#604)', () => {
  const row = (
    collection: string,
    state: ContentRow['lifecycle']['state'],
    slug: string
  ): ContentRow => ({
    ref: { collection, locale: 'en', slug },
    title: slug,
    locale: 'en',
    lifecycle: { state },
    updatedAt: 0,
    hasDraft: false,
    date: null,
    tags: [],
    categories: [],
    mediaRefs: [],
    audit: { audited: false, hasTitle: true, imagesWithoutAlt: 0, h1Count: 0 },
    hasFeaturedImage: false,
    hasSeoOverrides: false
  })

  // Deliberately lopsided toward pages: the shipped bug was invisible whenever
  // pages happened to be scarce, and the 14 unreachable staged PAGES are what
  // made it visible in UAT.
  const corpus: ContentRow[] = [
    row('post', 'live', 'p-live'),
    row('post', 'staged', 'p-staged'),
    row('post', 'draft', 'p-draft'),
    row('post', 'unpublished', 'p-down'),
    row('page', 'live', 'g-live'),
    row('page', 'staged', 'g-staged-1'),
    row('page', 'staged', 'g-staged-2'),
    row('page', 'staged', 'g-staged-3'),
    row('page', 'unpublished', 'g-down'),
    row('page', 'draft', 'g-draft')
  ]

  /** '/posts', '/pages' and '/content?status=x' → the query the list screen
   *  builds from that route + URL params. */
  const queryForHref = (href: string): IndexQuery => {
    const [path, search] = href.split('?')
    const collection =
      path === '/posts' ? 'post' : path === '/pages' ? 'page' : undefined
    const raw = new URLSearchParams(search ?? '').get('status') ?? ''
    return {
      ...(collection !== undefined ? { collection } : {}),
      ...(isIndexStatusFilter(raw) ? { status: raw } : {}),
      offset: 0,
      limit: 1000
    }
  }

  it('every tile count is reproduced by its own destination query', () => {
    const counts = dashboardCountsFromStats(
      selectIndexStats(corpus.map(projectRow))
    )
    wrap(<StatTiles {...counts} />)
    const indexRows = corpus.map(projectRow)

    const tiles: [RegExp, number][] = [
      [/Posts/, counts.posts],
      [/Pages/, counts.pages],
      [/Live/, counts.live],
      [/Staged/, counts.staged],
      [/Drafts/, counts.drafts]
    ]
    for (const [name, value] of tiles) {
      const href = screen.getByRole('link', { name }).getAttribute('href')!
      const landed = runQuery(indexRows, queryForHref(href)).total
      expect(
        `${name.source} tile=${value} destination(${href})=${landed}`
      ).toBe(`${name.source} tile=${value} destination(${href})=${value}`)
    }
  })

  // The invariant #611 broke, asserted through the rendered tiles rather than
  // the helper: with entries in 'unpublished' (i.e. after the first deploy) the
  // status tiles must still account for every post and page.
  it('Live + Staged + Drafts === Posts + Pages with taken-down entries present', () => {
    const counts = dashboardCountsFromStats(
      selectIndexStats(corpus.map(projectRow))
    )
    expect(corpus.some((r) => r.lifecycle.state === 'unpublished')).toBe(true)
    expect(counts.live + counts.staged + counts.drafts).toBe(
      counts.posts + counts.pages
    )
  })
})

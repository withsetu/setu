import { describe, expect, it } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { TiptapDoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { ActorProvider } from '../src/auth/actor'
import { ContentList } from '../src/screens/ContentList'

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})

function setup(initialEntries = ['/posts']) {
  const data = createMemoryDataPort([
    {
      collection: 'post',
      locale: 'en',
      slug: 'alpha',
      content: doc('x'),
      metadata: {
        title: 'Alpha',
        status: 'draft',
        categories: ['guides'],
        tags: ['react'],
        featuredImage: '/media/2026/07/alpha.webp',
        seo: { title: 'Alpha for robots' }
      }
    },
    {
      collection: 'post',
      locale: 'en',
      slug: 'beta',
      content: doc('x'),
      metadata: {
        title: 'Beta',
        status: 'draft',
        categories: ['news'],
        tags: ['vue']
      }
    }
  ])
  const git = createMemoryGitPort([
    {
      path: 'taxonomy/categories.yaml',
      content:
        '- slug: guides\n  name: Guides\n  parent: null\n- slug: news\n  name: News\n  parent: null\n'
    }
  ])
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <ServicesProvider services={servicesFor(data, git)}>
        <DeployProvider>
          <IndexProvider>
            <TaxonomyProvider>
              <ActorProvider>
                <ContentList collection="post" title="Posts" />
              </ActorProvider>
            </TaxonomyProvider>
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    </MemoryRouter>
  )
}

describe('ContentList — filters', () => {
  it('lists all entries with no filter', async () => {
    setup()
    expect(await screen.findByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('search box narrows the list', async () => {
    setup()
    await screen.findByText('Alpha')
    fireEvent.change(screen.getByLabelText('Search'), {
      target: { value: 'alph' }
    })
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull())
    expect(screen.getByText('Alpha')).toBeTruthy()
  })

  it('category filter narrows the list (via URL pre-population)', async () => {
    // The shadcn Select trigger is a Radix popover; simulate the filter via URL (same code path).
    setup(['/posts?category=news'])
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull())
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('featured-image filter narrows the list in both directions (#576)', async () => {
    setup(['/posts?featured=has'])
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull())
    expect(screen.getByText('Alpha')).toBeTruthy()
  })

  it('featured=none keeps only entries without a featured image (#576)', async () => {
    setup(['/posts?featured=none'])
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull())
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('custom-SEO filter narrows the list in both directions (#577)', async () => {
    setup(['/posts?seo=custom'])
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull())
    expect(screen.getByText('Alpha')).toBeTruthy()
  })

  it('seo=none keeps only entries without custom SEO (#577)', async () => {
    setup(['/posts?seo=none'])
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull())
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('pre-populates filters from the URL (deep link)', async () => {
    setup(['/posts?status=draft&q=beta'])
    await waitFor(() => expect(screen.getByText('Beta')).toBeTruthy())
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>('Search').value).toBe('beta')
  })

  // #579 + #598: the dashboard tiles deep-link with ?status=live|staged|
  // published|draft. Each must land IN the toolbar's filter state — a URL the
  // list silently ignored would show an unfiltered list under a filtered
  // heading, which is the redundancy #598 set out to remove.
  // #598 simplified the MENU to Live / Staged / Drafts, but every value below
  // stays a valid URL filter — deep links and the index port contract depend on
  // it. Each must still land IN the toolbar's filter state and be named there.
  it('round-trips every valid status from the URL into the filter control (#579, #598)', async () => {
    for (const [param, shown] of [
      ['live', 'Live'],
      ['staged', 'Staged'],
      ['not-published', 'Drafts'],
      ['published', 'Published'],
      ['draft', 'Draft'],
      ['unpublished', 'Unpublished']
    ] as const) {
      setup([`/posts?status=${param}`])
      const trigger = await screen.findByLabelText('Filter by status')
      expect(trigger).toHaveTextContent(shown)
      cleanup()
    }
  })

  it('status=published keeps staged+live and drops drafts (#579)', async () => {
    // Both fixtures are DataPort-only drafts, so the staged+live union is empty
    // — proving the param reaches the query rather than being dropped.
    setup(['/posts?status=published'])
    expect(await screen.findByText(/match these filters/i)).toBeTruthy()
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.queryByText('Beta')).toBeNull()
  })

  // The regression #598's menu shrink could have caused: dropping an option from
  // the dropdown must not stop the value FILTERING when it arrives by URL.
  // Both fixtures are DataPort-only drafts.
  it('status=draft still filters even though it left the menu (#598)', async () => {
    setup(['/posts?status=draft'])
    expect(await screen.findByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('status=unpublished still filters even though it left the menu (#598)', async () => {
    setup(['/posts?status=unpublished'])
    expect(await screen.findByText(/match these filters/i)).toBeTruthy()
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.queryByText('Beta')).toBeNull()
  })

  it('status=not-published keeps the drafts (#611)', async () => {
    setup(['/posts?status=not-published'])
    expect(await screen.findByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('ignores a status the index cannot filter on, rather than emptying the list (#579)', async () => {
    setup(['/posts?status=bogus'])
    expect(await screen.findByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByLabelText('Filter by status')).toHaveTextContent(
      'All status'
    )
  })

  it('shows a filtered-empty state with a clear action', async () => {
    setup(['/posts?q=zzzznomatch'])
    expect(await screen.findByText(/match these filters/i)).toBeTruthy()
    // Only one "Clear filters" button shows in the filtered-empty state (toolbar hides its own).
    const clearBtn = screen.getByRole('button', { name: /clear filters/i })
    fireEvent.click(clearBtn)
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy())
  })
})

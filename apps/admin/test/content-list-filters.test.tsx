import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { TiptapDoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { ContentList } from '../src/screens/ContentList'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

function setup(initialEntries = ['/posts']) {
  const data = createMemoryDataPort([
    { collection: 'post', locale: 'en', slug: 'alpha', content: doc('x'), metadata: { title: 'Alpha', status: 'draft', categories: ['guides'], tags: ['react'] } },
    { collection: 'post', locale: 'en', slug: 'beta', content: doc('x'), metadata: { title: 'Beta', status: 'draft', categories: ['news'], tags: ['vue'] } },
  ])
  const git = createMemoryGitPort([
    { path: 'taxonomy/categories.yaml', content: '- slug: guides\n  name: Guides\n  parent: null\n- slug: news\n  name: News\n  parent: null\n' },
  ])
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <ServicesProvider services={servicesFor(data, git)}>
        <DeployProvider><IndexProvider><TaxonomyProvider>
          <ContentList collection="post" title="Posts" />
        </TaxonomyProvider></IndexProvider></DeployProvider>
      </ServicesProvider>
    </MemoryRouter>,
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
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'alph' } })
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull())
    expect(screen.getByText('Alpha')).toBeTruthy()
  })

  it('category filter narrows the list', async () => {
    setup()
    await screen.findByText('Alpha')
    await screen.findByRole('option', { name: /News/i })
    fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'news' } })
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull())
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('pre-populates filters from the URL (deep link)', async () => {
    setup(['/posts?status=draft&q=beta'])
    await waitFor(() => expect(screen.getByText('Beta')).toBeTruthy())
    expect(screen.queryByText('Alpha')).toBeNull()
    expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe('beta')
  })

  it('shows a filtered-empty state with a clear action', async () => {
    setup(['/posts?q=zzzznomatch'])
    expect(await screen.findByText(/match these filters/i)).toBeTruthy()
    fireEvent.click(screen.getByText(/clear filters/i))
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy())
  })
})

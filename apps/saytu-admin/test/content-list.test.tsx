import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryDataPort } from '@saytu/db-memory'
import type { DataPort, DraftInput, TiptapDoc } from '@saytu/core'
import { DataProvider } from '../src/data/store'
import { ContentList } from '../src/screens/ContentList'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const seed: DraftInput[] = [
  { collection: 'post', locale: 'en', slug: 'p1', content: doc('x'), metadata: { title: 'First Post', status: 'published' } },
  { collection: 'post', locale: 'en', slug: 'p2', content: doc('y'), metadata: { title: 'Second Post', status: 'draft' } },
  { collection: 'page', locale: 'en', slug: 'about', content: doc('z'), metadata: { title: 'About', status: 'published' } },
]

const renderList = (adapter: DataPort, collection: string, title: string) =>
  render(
    <MemoryRouter>
      <DataProvider adapter={adapter}>
        <ContentList collection={collection} title={title} />
      </DataProvider>
    </MemoryRouter>,
  )

describe('ContentList', () => {
  it('renders a row per draft in the collection with title + status', async () => {
    renderList(createMemoryDataPort(seed), 'post', 'Posts')
    expect(await screen.findByText('First Post')).toBeInTheDocument()
    expect(screen.getByText('Second Post')).toBeInTheDocument()
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(screen.queryByText('About')).not.toBeInTheDocument()
  })

  it('renders a page header with the title and an entry count', async () => {
    renderList(createMemoryDataPort(seed), 'post', 'Posts')
    // wait for data rows to be present before asserting header state
    await screen.findByText('First Post')
    expect(screen.getByRole('heading', { name: /^Posts/ })).toBeInTheDocument()
    // 2 posts in the seed
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('filters to the given collection', async () => {
    renderList(createMemoryDataPort(seed), 'page', 'Pages')
    expect(await screen.findByText('About')).toBeInTheDocument()
    expect(screen.queryByText('First Post')).not.toBeInTheDocument()
  })

  it('shows an empty state when the collection has no drafts', async () => {
    renderList(createMemoryDataPort([]), 'post', 'Posts')
    expect(await screen.findByText(/no posts yet/i)).toBeInTheDocument()
  })
})

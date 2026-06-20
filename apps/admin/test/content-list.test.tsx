import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryDataPort } from '@setu/db-memory'
import type { DataPort, DraftInput, TiptapDoc } from '@setu/core'
import { DeployProvider } from '../src/deploy/deploy'
import { ContentList } from '../src/screens/ContentList'
import { serializeMdoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { IndexProvider } from '../src/data/index-store'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const seed: DraftInput[] = [
  { collection: 'post', locale: 'en', slug: 'p1', content: doc('x'), metadata: { title: 'First Post', status: 'published' } },
  { collection: 'post', locale: 'en', slug: 'p2', content: doc('y'), metadata: { title: 'Second Post', status: 'draft' } },
  { collection: 'page', locale: 'en', slug: 'about', content: doc('z'), metadata: { title: 'About', status: 'published' } },
]

const renderList = (adapter: DataPort, collection: string, title: string) =>
  render(
    <MemoryRouter>
      <ServicesProvider services={servicesFor(adapter, createMemoryGitPort())}>
        <DeployProvider>
          <IndexProvider>
            <ContentList collection={collection} title={title} />
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    </MemoryRouter>,
  )

describe('ContentList', () => {
  it('renders a row per draft in the collection with title + derived status', async () => {
    renderList(createMemoryDataPort(seed), 'post', 'Posts')
    expect(await screen.findByText('First Post')).toBeInTheDocument()
    expect(screen.getByText('Second Post')).toBeInTheDocument()
    // git is empty (createMemoryGitPort) so both posts derive to Draft regardless of metadata.status
    expect(await screen.findAllByText('Draft', { selector: '.badge' })).toHaveLength(2)
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

  it('does not show a "view on site" link for draft-only entries (nothing to view yet)', async () => {
    renderList(createMemoryDataPort(seed), 'post', 'Posts')
    await screen.findByText('First Post')
    expect(screen.queryByRole('link', { name: /on site/i })).not.toBeInTheDocument()
  })

  it('paginates: shows page size and advances with Next', async () => {
    const many: DraftInput[] = Array.from({ length: 30 }, (_, i) => ({
      collection: 'post', locale: 'en', slug: `p${i}`, content: doc('x'),
      metadata: { title: `Post ${String(i).padStart(2, '0')}` },
    }))
    renderList(createMemoryDataPort(many), 'post', 'Posts')
    expect(await screen.findByText(/1–25 of 30/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByText(/26–30 of 30/)).toBeInTheDocument()
  })
})

describe('ContentList — Git-only (published, no draft) entries', () => {
  const ghostMdoc = serializeMdoc({ frontmatter: { title: 'Ghost Post' }, body: 'Still here.' })

  const renderWithGit = () => {
    const git = createMemoryGitPort([{ path: 'content/post/en/ghost.mdoc', content: ghostMdoc }])
    const services = servicesFor(createMemoryDataPort([]), git)
    return render(
      <MemoryRouter>
        <ServicesProvider services={services}>
          <DeployProvider>
            <IndexProvider>
              <ContentList collection="post" title="Posts" />
            </IndexProvider>
          </DeployProvider>
        </ServicesProvider>
      </MemoryRouter>,
    )
  }

  it('lists a committed entry that has no draft, with a Staged pill and a dash for Updated', async () => {
    renderWithGit()
    expect(await screen.findByText('Ghost Post')).toBeInTheDocument()
    expect(screen.getByText('Staged', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('links a Git-only entry to its editor route (fork-on-open)', async () => {
    renderWithGit()
    const link = await screen.findByRole('link', { name: 'Ghost Post' })
    expect(link).toHaveAttribute('href', '/edit/post/en/ghost')
  })

  it('shows a "view on site" link for a published (Staged) entry, pointing at its live URL', async () => {
    renderWithGit()
    const view = await screen.findByRole('link', { name: /view ghost post on site/i })
    expect(view).toHaveAttribute('href', 'http://localhost:4321/post/ghost')
    expect(view).toHaveAttribute('target', '_blank')
    expect(view).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

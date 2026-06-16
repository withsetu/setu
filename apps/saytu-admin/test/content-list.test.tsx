import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryDataPort } from '@saytu/db-memory'
import type { DataPort, DraftInput, TiptapDoc } from '@saytu/core'
import { DataProvider } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { ContentList } from '../src/screens/ContentList'
import { serializeMdoc } from '@saytu/core'
import { createMemoryGitPort } from '@saytu/git-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'

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
        <DeployProvider>
          <ContentList collection={collection} title={title} />
        </DeployProvider>
      </DataProvider>
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
            <ContentList collection="post" title="Posts" />
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
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type {
  DataPort,
  GitPort,
  DraftInput,
  IndexService,
  IndexStats,
  TiptapDoc
} from '@setu/core'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { ActorProvider } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { CommandRegistryProvider } from '../src/command/registry'
import { Dashboard } from '../src/screens/Dashboard'
import { App } from '../src/app'

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})
const seed: DraftInput[] = [
  {
    collection: 'post',
    locale: 'en',
    slug: 'p1',
    content: doc('a'),
    metadata: { title: 'First Post', status: 'draft' }
  }
]

function renderDash(data: DataPort, git: GitPort) {
  return render(
    <MemoryRouter>
      <ServicesProvider services={servicesFor(data, git)}>
        <ActorProvider>
          <DeployProvider>
            <IndexProvider>
              <Dashboard />
            </IndexProvider>
          </DeployProvider>
        </ActorProvider>
      </ServicesProvider>
    </MemoryRouter>
  )
}

describe('Dashboard', () => {
  beforeEach(() => localStorage.clear())

  it('shows the greeting and header actions', async () => {
    renderDash(createMemoryDataPort(seed), createMemoryGitPort())
    expect(
      await screen.findByText(/here's your site at a glance/)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /New post/ })).toHaveAttribute(
      'href',
      '/edit/post/en/new'
    )
    expect(screen.getByRole('link', { name: /New page/ })).toHaveAttribute(
      'href',
      '/edit/page/en/new'
    )
  })

  // #572: widget shells paint immediately with skeleton placeholders — no zero/empty
  // flash — and fill in with linked stats once the entries land.
  it('paints skeleton shells while entries load, then fills with linked stats (#572)', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const base = createMemoryGitPort()
    const git: GitPort = {
      ...base,
      list: async (prefix: string) => {
        await gate
        return base.list(prefix)
      }
    }
    const { container } = renderDash(createMemoryDataPort(seed), git)

    // Shells are up straight away, numbers are skeletons: no premature zeros.
    expect(screen.getByText('At a glance')).toBeInTheDocument()
    expect(screen.getByText('Resume editing')).toBeInTheDocument()
    expect(screen.getByText(/Site & deploy/)).toBeInTheDocument()
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByText(/No edits yet/)).toBeNull()

    release()

    // Data lands: the seeded draft shows up and the stats become links.
    expect(await screen.findByText('First Post')).toBeInTheDocument()
    const glance = screen
      .getByText('At a glance')
      .closest('[data-slot="card"]') as HTMLElement
    expect(glance.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0)
    expect(within(glance).getByRole('link', { name: /Posts/ })).toHaveAttribute(
      'href',
      '/posts'
    )
    expect(within(glance).getByRole('link', { name: /Pages/ })).toHaveAttribute(
      'href',
      '/pages'
    )
    expect(
      within(glance).getByRole('link', { name: /Published/ })
    ).toHaveAttribute('href', '/posts')
    expect(
      within(glance).getByRole('link', { name: /Drafts/ })
    ).toHaveAttribute('href', '/posts?status=draft')
  })

  // #587: the At-a-glance counts come from index.stats() (ONE call), Resume
  // editing from a limited index.query() — never a per-entry git body fetch.
  it('renders counts from index.stats() and Resume editing from a limited query, without reading git bodies', async () => {
    const stats: IndexStats = {
      post: { total: 12, draft: 3, staged: 4, live: 5, unpublished: 0 },
      page: { total: 4, draft: 1, staged: 0, live: 3, unpublished: 0 }
    }
    const query = vi.fn(async (q: { collection: string; limit: number }) => ({
      rows:
        q.collection === 'post'
          ? [
              {
                ref: { collection: 'post', locale: 'en', slug: 'recent-post' },
                title: 'Recent Post',
                locale: 'en',
                lifecycle: { state: 'live' as const },
                updatedAt: 999,
                hasDraft: false,
                date: null,
                tags: [],
                categories: [],
                mediaRefs: [],
                audit: {
                  audited: false,
                  hasTitle: true,
                  imagesWithoutAlt: 0,
                  h1Count: 0
                },
                hasFeaturedImage: false,
                hasSeoOverrides: false
              }
            ]
          : [],
      total: q.collection === 'post' ? 12 : 4
    }))
    const stub: IndexService = {
      ensureBuilt: vi.fn(async () => {}),
      rebuild: vi.fn(async () => {}),
      reindexEntry: vi.fn(async () => {}),
      reindexEntries: vi.fn(async () => {}),
      reindexAfterDeploy: vi.fn(async () => {}),
      markSyncedAt: vi.fn(async () => {}),
      query,
      stats: vi.fn(async () => stats),
      distinctTags: vi.fn(async () => []),
      distinctLocales: vi.fn(async () => []),
      categoryCounts: vi.fn(async () => ({})),
      tagCounts: vi.fn(async () => ({})),
      referencedBy: vi.fn(async () => []),
      entriesByCategory: vi.fn(async () => []),
      entriesByTag: vi.fn(async () => []),
      auditSummary: vi.fn(async () => ({
        titleOffenders: [],
        altOffenders: [],
        h1Offenders: [],
        entryIds: [],
        locales: []
      }))
    }
    const git = createMemoryGitPort()
    const readFile = vi.spyOn(git, 'readFile')
    const list = vi.spyOn(git, 'list')

    render(
      <MemoryRouter>
        <ServicesProvider services={servicesFor(createMemoryDataPort(), git)}>
          {/* author: no site-health / deploy cards, so the only git access left
              on screen is the counts path — which must touch none. */}
          <ActorProvider actor={{ id: 'a', role: 'author' }}>
            <DeployProvider>
              <IndexProvider service={stub}>
                <Dashboard />
              </IndexProvider>
            </DeployProvider>
          </ActorProvider>
        </ServicesProvider>
      </MemoryRouter>
    )

    // Posts=12, Pages=4, Published=staged+live across post+page (4+5 + 0+3)=12,
    // Drafts=3+1=4 — straight from stats(), no bodies fetched.
    const glance = (await screen.findByText('At a glance')).closest(
      '[data-slot="card"]'
    ) as HTMLElement
    expect(
      within(glance).getByRole('link', { name: /Posts/ })
    ).toHaveTextContent('12')
    expect(
      within(glance).getByRole('link', { name: /Pages/ })
    ).toHaveTextContent('4')
    expect(
      within(glance).getByRole('link', { name: /Published/ })
    ).toHaveTextContent('12')
    expect(
      within(glance).getByRole('link', { name: /Drafts/ })
    ).toHaveTextContent('4')

    // Resume editing is fed by the limited query (sorted, limit 5), not a scan.
    expect(await screen.findByText('Recent Post')).toBeInTheDocument()
    expect(stub.stats).toHaveBeenCalledTimes(1)
    for (const call of query.mock.calls) {
      expect(call[0].limit).toBe(5)
    }
    // The dashboard never reaches around the index into content bodies or does
    // its own content/ scan (SiteHealthCard's single site-health.json read is
    // unrelated). The old fetch-all path read every content/<c>/… entry.
    const contentReads = readFile.mock.calls.filter((c) =>
      String(c[0]).startsWith('content/')
    )
    expect(contentReads).toHaveLength(0)
    const contentLists = list.mock.calls.filter((c) =>
      String(c[0]).startsWith('content/')
    )
    expect(contentLists).toHaveLength(0)
  })

  it('shows an inline error state when data load fails', async () => {
    const git: GitPort = {
      ...createMemoryGitPort(),
      list: () => Promise.reject(new Error('boom'))
    }
    renderDash(createMemoryDataPort(seed), git)
    expect(await screen.findByText(/couldn't load/i)).toBeInTheDocument()
  })
})

describe('admin landing route', () => {
  it('redirects / to the dashboard', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <ServicesProvider
          services={servicesFor(
            createMemoryDataPort(seed),
            createMemoryGitPort()
          )}
        >
          <ActorProvider>
            <NotificationProvider>
              <DeployProvider>
                <IndexProvider>
                  <CommandRegistryProvider>
                    <App />
                  </CommandRegistryProvider>
                </IndexProvider>
              </DeployProvider>
            </NotificationProvider>
          </ActorProvider>
        </ServicesProvider>
      </MemoryRouter>
    )
    expect(
      await screen.findByText(/here's your site at a glance/)
    ).toBeInTheDocument()
  })
})

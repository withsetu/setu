import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { DataPort, GitPort, DraftInput, TiptapDoc } from '@setu/core'
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

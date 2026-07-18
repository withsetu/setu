import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { ActorProvider } from '../src/auth/actor'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { TagsProvider } from '../src/data/tags-store'
import { NotificationProvider } from '../src/ui/notify'
import { CommandRegistryProvider } from '../src/command/registry'
import { App } from '../src/app'
import { Taxonomies } from '../src/screens/taxonomies/Taxonomies'

vi.mock('../src/deploy/deploy', async (orig) => ({
  ...(await orig()),
  useDeploy: () => ({
    status: null,
    deployInfo: () => ({ deployedSha: null, changed: [] }),
    refresh: () => Promise.resolve(),
    rebuild: () => Promise.resolve()
  })
}))

function wrap(initialPath = '/taxonomies') {
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort())
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ActorProvider>
        <ServicesProvider services={services}>
          <DeployProvider>
            <IndexProvider>
              <TaxonomyProvider>
                <TagsProvider>
                  <NotificationProvider>
                    <CommandRegistryProvider>
                      <App />
                    </CommandRegistryProvider>
                  </NotificationProvider>
                </TagsProvider>
              </TaxonomyProvider>
            </IndexProvider>
          </DeployProvider>
        </ServicesProvider>
      </ActorProvider>
    </MemoryRouter>
  )
}

function wrapDirect() {
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort())
  return render(
    <MemoryRouter>
      <ServicesProvider services={services}>
        <DeployProvider>
          <IndexProvider>
            <TaxonomyProvider>
              <TagsProvider>
                <NotificationProvider>
                  <Taxonomies />
                </NotificationProvider>
              </TagsProvider>
            </TaxonomyProvider>
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    </MemoryRouter>
  )
}

describe('Taxonomies screen (via App router)', () => {
  it('renders both tab triggers at /taxonomies', () => {
    wrap()
    expect(screen.getByRole('tab', { name: /categories/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /tags/i })).toBeInTheDocument()
  })

  it('shows the page heading at /taxonomies', () => {
    wrap()
    expect(
      screen.getByRole('heading', { name: /taxonomies/i })
    ).toBeInTheDocument()
  })

  it('/categories redirects to /taxonomies and shows the tabs', () => {
    wrap('/categories')
    expect(screen.getByRole('tab', { name: /categories/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /tags/i })).toBeInTheDocument()
  })
})

describe('Taxonomies screen (direct mount)', () => {
  it('renders both tab triggers', () => {
    wrapDirect()
    expect(screen.getByRole('tab', { name: /categories/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /tags/i })).toBeInTheDocument()
  })

  it('shows the page heading', () => {
    wrapDirect()
    expect(
      screen.getByRole('heading', { name: /taxonomies/i })
    ).toBeInTheDocument()
  })

  it('Tags tab shows empty-state copy after activating the tab (no entries seeded)', async () => {
    wrapDirect()
    // Radix Tabs listens to mousedown (not click) for tab switching
    fireEvent.mouseDown(screen.getByRole('tab', { name: /tags/i }))
    // #582: the empty copy appears only once the load FINISHES with zero tags —
    // during the load the list shell shows skeletons instead.
    expect(
      await screen.findByText(/Tags appear here as you add them to content/i)
    ).toBeInTheDocument()
  })
})

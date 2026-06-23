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
import { NotificationProvider } from '../src/ui/notify'
import { App } from '../src/app'
import { Taxonomies } from '../src/screens/taxonomies/Taxonomies'

vi.mock('../src/deploy/deploy', async (orig) => ({
  ...(await orig() as object),
  useDeploy: () => ({ deployedAt: () => null, sha: null, deploy: () => Promise.resolve() }),
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
                <NotificationProvider>
                  <App />
                </NotificationProvider>
              </TaxonomyProvider>
            </IndexProvider>
          </DeployProvider>
        </ServicesProvider>
      </ActorProvider>
    </MemoryRouter>,
  )
}

function wrapDirect() {
  return render(
    <MemoryRouter>
      <Taxonomies />
    </MemoryRouter>,
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
    expect(screen.getByRole('heading', { name: /taxonomies/i })).toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: /taxonomies/i })).toBeInTheDocument()
  })

  it('Tags tab shows coming-soon copy after activating the tab', () => {
    wrapDirect()
    // Radix Tabs listens to mousedown (not click) for tab switching
    fireEvent.mouseDown(screen.getByRole('tab', { name: /tags/i }))
    expect(screen.getByText(/Tag management is coming soon/i)).toBeInTheDocument()
    expect(screen.getByText(/Bulk rename, merge, and cleanup will live here/i)).toBeInTheDocument()
  })
})

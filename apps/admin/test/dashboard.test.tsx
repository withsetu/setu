import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { DataPort, GitPort, DraftInput, TiptapDoc } from '@setu/core'
import { DeployProvider } from '../src/deploy/deploy'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { ActorProvider } from '../src/auth/actor'
import { Dashboard } from '../src/screens/Dashboard'
import { App } from '../src/app'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const seed: DraftInput[] = [
  { collection: 'post', locale: 'en', slug: 'p1', content: doc('a'), metadata: { title: 'First Post', status: 'draft' } },
]

function renderDash(data: DataPort, git: GitPort) {
  return render(
    <MemoryRouter>
      <ServicesProvider services={servicesFor(data, git)}>
        <ActorProvider>
          <DeployProvider>
            <Dashboard />
          </DeployProvider>
        </ActorProvider>
      </ServicesProvider>
    </MemoryRouter>,
  )
}

describe('Dashboard', () => {
  beforeEach(() => localStorage.clear())

  it('shows the greeting and header actions', async () => {
    renderDash(createMemoryDataPort(seed), createMemoryGitPort())
    expect(await screen.findByText(/here's your site at a glance/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /New post/ })).toHaveAttribute('href', '/edit/post/en/new')
    expect(screen.getByRole('link', { name: /New page/ })).toHaveAttribute('href', '/edit/page/en/new')
  })

  it('shows an inline error state when data load fails', async () => {
    const git: GitPort = { ...createMemoryGitPort(), list: () => Promise.reject(new Error('boom')) }
    renderDash(createMemoryDataPort(seed), git)
    expect(await screen.findByText(/couldn't load/i)).toBeInTheDocument()
  })
})

describe('admin landing route', () => {
  it('redirects / to the dashboard', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <ServicesProvider services={servicesFor(createMemoryDataPort(seed), createMemoryGitPort())}>
          <ActorProvider>
            <DeployProvider>
              <App />
            </DeployProvider>
          </ActorProvider>
        </ServicesProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/here's your site at a glance/)).toBeInTheDocument()
  })
})

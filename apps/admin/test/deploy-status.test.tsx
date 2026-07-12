import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { DeployStatus } from '@setu/core'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, createServices } from '../src/data/store'
import { DeployProvider, useDeploy } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'
import { NotificationProvider } from '../src/ui/notify'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { CommandRegistryProvider } from '../src/command/registry'

// Server deploy truth, mutable per-test: starts never-deployed; the "deploy" is the
// server recording a deploy (deployedSha set, nothing changed since), which the
// provider picks up on refresh (#208 — server-backed, replacing the client snapshot).
const state: { status: DeployStatus | null } = { status: null }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

function RefreshTrigger() {
  const { refresh } = useDeploy()
  return <button onClick={() => void refresh()}>refresh-deploy</button>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('deploy status', () => {
  it('after publish + a server-recorded deploy, the editor status pill shows Live', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) =>
        String(input).endsWith('/api/deploy/status')
          ? state.status === null
            ? json({ error: 'unavailable' }, 503)
            : json(state.status)
          : json({ error: 'not found' }, 404)
      )
    )
    const services = createServices()
    render(
      <TooltipProvider>
        <NotificationProvider>
          <MemoryRouter initialEntries={['/edit/post/en/release-notes']}>
            <ActorProvider>
              <ServicesProvider services={services}>
                <DeployProvider>
                  <IndexProvider>
                    <TaxonomyProvider>
                      <CommandRegistryProvider>
                        <RefreshTrigger />
                        <Routes>
                          <Route
                            path="/edit/:collection/:locale/:slug"
                            element={<EditorScreen />}
                          />
                        </Routes>
                      </CommandRegistryProvider>
                    </TaxonomyProvider>
                  </IndexProvider>
                </DeployProvider>
              </ServicesProvider>
            </ActorProvider>
          </MemoryRouter>
        </NotificationProvider>
      </TooltipProvider>
    )
    await screen.findByDisplayValue('Release notes')
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    await waitFor(() =>
      expect(
        screen.getByText('Staged', { selector: '[data-slot="badge"]' })
      ).toBeInTheDocument()
    )
    // The server records a deploy at current HEAD (nothing changed since) …
    state.status = {
      deployedSha: 'deploy-1',
      deployedAt: '2026-07-09T00:00:00Z',
      headSha: 'deploy-1',
      pending: false,
      changedPaths: [],
      job: null,
      canRebuild: true
    }
    // … and once the provider refreshes, the pill flips to Live.
    fireEvent.click(screen.getByText('refresh-deploy'))
    await waitFor(() =>
      expect(
        screen.getByText('Live', { selector: '[data-slot="badge"]' })
      ).toBeInTheDocument()
    )
  })
})

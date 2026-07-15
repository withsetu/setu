import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, createServices } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'
import { NotificationProvider } from '../src/ui/notify'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { CommandRegistryProvider } from '../src/command/registry'

function renderEditor(path = '/edit/post/en/release-notes') {
  render(
    <TooltipProvider>
      <NotificationProvider>
        <MemoryRouter initialEntries={[path]}>
          <ActorProvider>
            <ServicesProvider services={createServices()}>
              <DeployProvider>
                <IndexProvider>
                  <TaxonomyProvider>
                    <CommandRegistryProvider>
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
}

afterEach(() => vi.unstubAllEnvs())

describe('EditorScreen preview', () => {
  it('hides the Preview button without a bridge api (pure in-browser mode)', async () => {
    vi.stubEnv('VITE_SETU_API', '')
    renderEditor()
    await screen.findByDisplayValue('Release notes')
    expect(
      screen.queryByRole('button', {
        name: /preview the draft in your site theme/i
      })
    ).not.toBeInTheDocument()
  })

  it('compiles the current draft, POSTs it to the api, and opens the site preview', async () => {
    vi.stubEnv('VITE_SETU_API', 'http://localhost:4444')
    vi.stubEnv('VITE_SETU_SITE', 'http://localhost:4321')
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const openMock = vi.fn().mockReturnValue({
      closed: false,
      focus: vi.fn(),
      location: { href: '' }
    })
    vi.stubGlobal('open', openMock)

    renderEditor()
    await screen.findByDisplayValue('Release notes')
    fireEvent.click(
      screen.getByRole('button', {
        name: /preview the draft in your site theme/i
      })
    )

    // The DeployProvider's status GET also rides this fetch mock — find the preview
    // POST by URL instead of assuming call order.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.find(([u]) => String(u).includes('/preview'))
      ).toBeTruthy()
    )
    const [url, init] = fetchMock.mock.calls.find(([u]) =>
      String(u).includes('/preview')
    )!
    expect(url).toBe('http://localhost:4444/preview')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      collection: 'post',
      locale: 'en',
      slug: 'release-notes'
    })
    expect(typeof body.content).toBe('string') // a compiled .mdoc
    await waitFor(() => expect(openMock).toHaveBeenCalled())
    expect(openMock.mock.calls[0]![0] as string).toContain(
      'http://localhost:4321/preview'
    )
    expect(openMock.mock.calls[0]![1]).toBe('setu-preview')
  })
})

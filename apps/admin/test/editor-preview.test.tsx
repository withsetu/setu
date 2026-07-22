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

// ---------------------------------------------------------------------------------
// #804 — Preview must never be silently inert. `onPreview` awaited the POST with no
// `catch` and was called as a bare `void onPreview()`; there is no
// `unhandledrejection` handler in apps/admin/src and the React error boundary does
// not see async rejections. Offline, on a 5xx, or with pop-ups blocked, clicking
// Preview produced no toast, no tab and no state change. Same shape as #798's
// commit(), one function away in the same file.
// ---------------------------------------------------------------------------------
describe('#804 a failed preview is never silent', () => {
  /** fetch stub: the /preview POST behaves as `preview`, everything else (the
   *  DeployProvider status GET) answers 200 so only the POST is under test. */
  function stubFetch(preview: () => Promise<unknown>) {
    const fetchMock = vi.fn((input: unknown) =>
      String(input).includes('/preview')
        ? preview()
        : Promise.resolve({ ok: true, json: async () => ({}) })
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  const clickPreview = () =>
    fireEvent.click(
      screen.getByRole('button', {
        name: /preview the draft in your site theme/i
      })
    )

  async function readyEditor() {
    vi.stubEnv('VITE_SETU_API', 'http://localhost:4444')
    vi.stubEnv('VITE_SETU_SITE', 'http://localhost:4321')
    renderEditor()
    await screen.findByDisplayValue('Release notes')
  }

  it('reports an error and opens no tab when the preview POST rejects', async () => {
    stubFetch(() => Promise.reject(new Error('offline')))
    const openMock = vi.fn()
    vi.stubGlobal('open', openMock)

    await readyEditor()
    clickPreview()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't open the preview/i)
    expect(openMock).not.toHaveBeenCalled()
  })

  it('reports an error and opens no tab when the api answers 5xx', async () => {
    // A non-ok response means the draft was never stored: opening the tab would
    // show the PREVIOUS preview and read as success.
    stubFetch(() =>
      Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
    )
    const openMock = vi.fn()
    vi.stubGlobal('open', openMock)

    await readyEditor()
    clickPreview()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't open the preview/i)
    expect(openMock).not.toHaveBeenCalled()
  })

  it('reports an error when the browser blocks the preview pop-up', async () => {
    stubFetch(() => Promise.resolve({ ok: true, json: async () => ({}) }))
    vi.stubGlobal(
      'open',
      vi.fn(() => null)
    )

    await readyEditor()
    clickPreview()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/pop-up/i)
  })
})

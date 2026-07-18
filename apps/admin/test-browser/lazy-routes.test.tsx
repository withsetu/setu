import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { MemoryRouter } from 'react-router-dom'
import { lazy, type ReactElement } from 'react'
import type { Actor } from '@setu/core'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { App } from '../src/app'
import { RouteBoundary } from '../src/shell/RouteBoundary'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { AppMediaIndexProvider } from '../src/data/media-index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { TagsProvider } from '../src/data/tags-store'
import { NotificationProvider } from '../src/ui/notify'
import { CommandRegistryProvider } from '../src/command/registry'
import { SettingsProvider } from '../src/data/settings-store'
import { TooltipProvider } from '../src/components/ui/tooltip'

// ---------------------------------------------------------------------------------
// #597 route-level code splitting — the browser-mode half.
//
// Every screen below the dashboard is now a `React.lazy` dynamic import. That is
// exactly CLAUDE.md failure mode #3 (the jsdom Mirage) territory: a lazy boundary
// wrapped around Radix/ProseMirror code can resolve fine under jsdom's synchronous
// module graph and still white-screen in a real browser — a chunk that never settles
// leaves a permanently blank region, and React's default for a REJECTED lazy import
// is an unmounted tree, which looks identical to "the app is broken".
//
// So this file drives the REAL App router in real chromium, one navigation per lazy
// route, and asserts each one actually resolves to its real screen. A route that
// suspends forever or throws on chunk load fails here instead of reaching the owner.
// The last two cases cover the boundary itself: the Suspense fallback is a visible
// loading frame (not a blank flash), and a rejected chunk shows an honest recovery
// message with a reload action.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

// Several of these screens fetch on mount (users, forms, site health). There is no
// API behind the vitest browser server — it answers every path with index.html — so
// an unstubbed run dies on `Response.json()` parsing HTML, which has nothing to do
// with what this file tests. Answer every request with an empty-but-valid JSON
// envelope: enough for each screen to finish loading and render its heading, which
// is the only thing asserted here.
beforeEach(() => {
  // A fresh Response per call — a Response body is a stream and can only be read
  // once, so a single shared instance breaks the second fetch.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({ users: [], submissions: [], forms: [], items: [] })
  )
})
afterEach(() => vi.restoreAllMocks())

const ADMIN: Actor = { id: 'u1', role: 'admin' }

function renderAt(path: string) {
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort())
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[path]}>
        <ActorProvider actor={ADMIN}>
          <ServicesProvider services={services}>
            <NotificationProvider>
              <DeployProvider>
                <IndexProvider>
                  <AppMediaIndexProvider>
                    <TaxonomyProvider>
                      <TagsProvider>
                        <CommandRegistryProvider>
                          <SettingsProvider>
                            <App />
                          </SettingsProvider>
                        </CommandRegistryProvider>
                      </TagsProvider>
                    </TaxonomyProvider>
                  </AppMediaIndexProvider>
                </IndexProvider>
              </DeployProvider>
            </NotificationProvider>
          </ServicesProvider>
        </ActorProvider>
      </MemoryRouter>
    </TooltipProvider>
  )
}

// path → the heading its real (non-fallback) screen renders. Matching the heading
// rather than any old text is what proves the CHUNK arrived: the Suspense fallback
// has no heading at all, so a stuck route can never satisfy these.
const LAZY_ROUTES: ReadonlyArray<[string, RegExp]> = [
  ['/media', /^Media$/],
  ['/taxonomies', /^Taxonomies$/],
  // PageHeader appends a count badge inside the <h1>, so the accessible name is
  // "Forms 0" once the (stubbed, empty) list resolves — anchor the start only.
  ['/forms', /^Forms/],
  ['/appearance', /^Appearance$/],
  ['/settings', /^Settings$/],
  ['/users', /Users & Roles/],
  ['/health', /Site Health/]
]

describe('lazy route chunks resolve in a real browser (#597)', () => {
  for (const [path, heading] of LAZY_ROUTES) {
    it(`${path} loads its screen`, async () => {
      renderAt(path)
      await expect
        .element(page.getByRole('heading', { name: heading, level: 1 }))
        .toBeInTheDocument()
    })
  }

  // The editor is the load-bearing one: the biggest chunk (Tiptap + ProseMirror +
  // Markdoc) behind the newest boundary, and the exact stack that has white-screened
  // this app before. Assert the real contenteditable canvas mounts, not just a frame.
  it('/edit/:collection/:locale/:slug loads the Tiptap canvas', async () => {
    renderAt('/edit/post/en/new')
    await expect
      .element(page.getByLabelText('Content editor'))
      .toBeInTheDocument()
  })
})

describe('RouteBoundary (#597)', () => {
  it('shows a visible loading frame — not a blank flash — while a chunk is in flight', async () => {
    let settle: (() => void) | undefined
    const Never = lazy(
      () =>
        new Promise<{ default: () => ReactElement }>((resolve) => {
          settle = () => resolve({ default: () => <p>arrived</p> })
        })
    )
    render(
      <MemoryRouter>
        <RouteBoundary>
          <Never />
        </RouteBoundary>
      </MemoryRouter>
    )
    // Real paint, real element: the frame is on screen while the import is pending.
    await expect
      .element(page.getByLabelText('Loading screen'))
      .toBeInTheDocument()
    settle?.()
    await expect.element(page.getByText('arrived')).toBeInTheDocument()
  })

  it('a rejected chunk surfaces an honest error with a reload action, never a blank screen', async () => {
    // React logs the caught error; expected here, and noise would fail nothing but
    // makes the run unreadable.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = lazy(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module'))
    )
    render(
      <MemoryRouter>
        <RouteBoundary>
          <Broken />
        </RouteBoundary>
      </MemoryRouter>
    )
    await expect
      .element(page.getByText(/couldn't be loaded/i))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /reload the admin/i }))
      .toBeInTheDocument()
    err.mockRestore()
  })
})

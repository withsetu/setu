import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { Actor } from '@setu/core'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { App } from '../src/app'
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
// #597 regression guard: the editor must still FUNCTION behind its lazy boundary,
// not merely render.
//
// The bug this file exists for: RouteBoundary originally carried `key={pathname}`
// on its error boundary, to clear a stale chunk-load failure when the user navigates
// away. That looks harmless and is not. The editor rewrites its OWN url — the first
// autosave of a new entry mints a real slug and `navigate(..., {replace: true})`s
// onto it — and #549 built EditorScreen's `entryIdentRef` epoch precisely so that
// self-mint does NOT remount the editor. A key on an ancestor sits above that whole
// mechanism and remounts regardless, destroying the in-flight autosave: the save
// indicator never settled, and seven e2e specs went red.
//
// test-browser/lazy-routes.test.tsx did not catch it because proving a lazy route
// RESOLVES AND PAINTS is a strictly weaker claim than proving it still works. The
// broken path was type → debounce → persist → indicator, which only runs if you
// actually type and then wait. So this test types, and waits.
//
// It must go through the real router + Suspense: mounting EditorScreen directly
// bypasses RouteBoundary entirely and would stay green with the bug present.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({})
  )
})
afterEach(() => vi.restoreAllMocks())

const ADMIN: Actor = { id: 'u1', role: 'admin' }

/** Surfaces the router's current pathname in the DOM so the test can assert the
 *  compose-mint navigation actually happened. Without this the test could pass
 *  vacuously: if the url never left `/edit/post/en/new`, the pathname key would
 *  never have changed and the regression could not fire either way. */
function LocationProbe() {
  const { pathname } = useLocation()
  return <output data-testid="pathname">{pathname}</output>
}

function renderEditorRoute() {
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort())
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={['/edit/post/en/new']}>
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
                            <LocationProbe />
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

describe('editor autosave survives the lazy route boundary (#597)', () => {
  it('typing a new entry mints a slug, replaces the url, and still settles the save indicator', async () => {
    renderEditorRoute()

    // The lazy editor chunk resolves and the real canvas mounts.
    const title = page.getByRole('textbox', { name: 'Title', exact: true })
    await expect.element(title).toBeInTheDocument()

    // Type — this is what the render-only test never did. Autosave debounces ~800ms,
    // then mints a slug and replaces the url mid-flight.
    await userEvent.fill(title, 'Lazy Boundary Autosave')

    // Precondition, asserted so the test can never pass vacuously: the editor really
    // did navigate onto its minted slug, i.e. the ancestor pathname really did change
    // while the editor was mid-save. This is the exact moment the `key` remounted it.
    await expect
      .element(page.getByTestId('pathname'))
      .not.toHaveTextContent('/edit/post/en/new')

    // And the autosave that triggered that navigation still completed. With the
    // remount bug this indicator never appeared — the editor was rebuilt from scratch
    // with a fresh 'idle' status and the pending save was discarded.
    await expect
      .element(page.getByText('Backed up on this device', { exact: true }))
      .toBeInTheDocument()
  })
})

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { DataPort, DraftInput, IndexService } from '@setu/core'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import type { Services } from '../src/data/store'
import { AppMediaIndexProvider } from '../src/data/media-index-store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'
import { NotificationProvider } from '../src/ui/notify'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { CommandRegistryProvider } from '../src/command/registry'

// ---------------------------------------------------------------------------------
// Autosave / mint state-machine races (slice 3). Each of these is a
// microtask/debounce interleaving between the autosave loop and an
// identity/lifecycle operation — the exact class jsdom cannot express (CLAUDE.md
// failure mode #3), so: real chromium, real Tiptap, real React scheduler.
//
// The reproduction lever throughout is a DataPort whose one armed `saveDraft` is
// held on a gate. That freezes one autosave mid-write (or, for #753, freezes the
// mint so a second debounce can queue behind it) and lets the test choose exactly
// when it lands relative to the lifecycle op — turning a wall-clock race into a
// deterministic one.
// ---------------------------------------------------------------------------------

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function LocationProbe() {
  return <div data-testid="loc">{useLocation().pathname}</div>
}

/** Wrap a memory DataPort so that ONE `saveDraft` — the first after `arm()` — is
 *  held on a gate until released. Everything before `arm()` passes straight
 *  through: crucially the fork-on-load write `loadForEdit` makes when opening a
 *  committed entry, which must complete for the editor to reach 'ready'. After
 *  arm, exactly one save (the autosave under test) freezes in flight; later
 *  service writes (rename/restore) still pass, so the test can choose when the
 *  frozen save lands relative to them. */
function gatedDataPort(seed: DraftInput[] = []) {
  const base = createMemoryDataPort(seed)
  let armed = false
  let entered = false
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const data: DataPort = {
    ...base,
    async saveDraft(input) {
      if (armed && !entered) {
        entered = true
        await gate
      }
      return base.saveDraft(input)
    }
  }
  return {
    data,
    base,
    /** Arm the gate: the next saveDraft (the autosave) will freeze. */
    arm: () => {
      armed = true
    },
    /** Release the one frozen save. */
    releaseGatedSave: () => release(),
    /** True once the frozen save has been entered (autosave is in flight). */
    gatedEntered: () => entered
  }
}

/** An IndexService that resolves every write on a bare microtask — no macrotask
 *  work that could hand React's (macrotask) scheduler a chance to flush the
 *  compose-mint navigation before the re-entrant autosave runs. Keeps #753's
 *  window microtask-only so the race is deterministic, not scheduler-dependent. */
function instantIndex(): IndexService {
  const noop = async (): Promise<void> => {}
  return {
    rebuild: noop,
    ensureBuilt: noop,
    reindexEntry: noop,
    reindexEntries: noop,
    reindexAfterDeploy: noop,
    markSyncedAt: noop,
    query: async () => ({ rows: [], total: 0 }),
    stats: async () => ({ total: 0 }),
    distinctTags: async () => [],
    distinctLocales: async () => [],
    categoryCounts: async () => ({}),
    tagCounts: async () => ({}),
    referencedBy: async () => [],
    entriesByCategory: async () => [],
    entriesByTag: async () => [],
    auditSummary: async () => ({})
  } as unknown as IndexService
}

function renderEditor(
  path: string,
  services: Services,
  opts: { index?: IndexService; extra?: ReactNode } = {}
) {
  return render(
    <TooltipProvider>
      <NotificationProvider>
        <MemoryRouter initialEntries={[path]}>
          <ActorProvider>
            <ServicesProvider services={services}>
              <AppMediaIndexProvider>
                <DeployProvider>
                  <IndexProvider service={opts.index}>
                    <TaxonomyProvider>
                      <CommandRegistryProvider>
                        <Routes>
                          <Route
                            path="/edit/:collection/:locale/:slug"
                            element={<EditorScreen />}
                          />
                        </Routes>
                        <LocationProbe />
                        {opts.extra}
                      </CommandRegistryProvider>
                    </TaxonomyProvider>
                  </IndexProvider>
                </DeployProvider>
              </AppMediaIndexProvider>
            </ServicesProvider>
          </ActorProvider>
        </MemoryRouter>
      </NotificationProvider>
    </TooltipProvider>
  )
}

const draftsIn = (data: DataPort, collection: string, locale: string) =>
  data
    .listDrafts({ collection })
    .then((all) => all.filter((d) => d.locale === locale))

// ---------------------------------------------------------------------------------
// #753 — compose double-mint. A new entry's first autosave mints a slug and
// persists it; a second edit during that in-flight mint queues a follow-up save,
// and the follow-up re-runs the SAME compose closure synchronously (before React
// re-renders onto the minted slug), minting a SECOND slug and creating a duplicate
// draft. One new post, two drafts.
// ---------------------------------------------------------------------------------

describe('compose autosave does not double-mint (#753)', () => {
  it('a second edit during the in-flight mint must not create a second draft', async () => {
    const { data, base, arm, releaseGatedSave, gatedEntered } = gatedDataPort()
    const services = servicesFor(data, createMemoryGitPort([]))
    renderEditor('/edit/post/en/new', services, { index: instantIndex() })

    await expect
      .element(page.getByLabelText('Content editor'))
      .toBeInTheDocument()

    // Compose has no fork-on-load write, so the first saveDraft IS the mint —
    // arm the gate before the first edit so the mint freezes in flight.
    arm()

    // First edit → arms the ~800ms debounce, which mints the slug and calls the
    // (gated) saveDraft. The mint is now frozen in flight.
    const title = page.getByRole('textbox', { name: 'Title', exact: true })
    await title.fill('Dup Guard')
    await expect.poll(() => gatedEntered(), { timeout: 8000 }).toBe(true)

    // Second edit WHILE the mint is frozen → a fresh debounce fires and, seeing a
    // save in flight, queues exactly one follow-up (pending). Wait past the debounce
    // so that follow-up is definitely armed before we release the mint.
    await title.fill('Dup Guard edited')
    await new Promise((r) => setTimeout(r, 1100))

    // Release the mint. Its finally runs the queued follow-up synchronously — the
    // re-entrancy the bug turns into a second mint.
    releaseGatedSave()

    await expect
      .element(page.getByTestId('loc'), { timeout: 8000 })
      .toHaveTextContent('/edit/post/en/dup-guard')

    // Exactly ONE draft for this new entry — never a `dup-guard` + `dup-guard-2`.
    await expect
      .poll(() => draftsIn(base, 'post', 'en').then((d) => d.length), {
        timeout: 8000
      })
      .toBe(1)
  }, 20000)
})

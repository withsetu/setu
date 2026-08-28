import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Services } from '../src/data/store'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, createServices } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'
import { NotificationProvider } from '../src/ui/notify'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { CommandRegistryProvider } from '../src/command/registry'

// ---------------------------------------------------------------------------------
// #1019 — a publish conflict used to be a dead end. The guard itself is correct (it
// fires only when THIS entry's committed file moved since the draft forked from it),
// but it surfaced as one toast: "The published version moved — reload to continue."
// Reloading is the one action that throws the author's unsaved work away, so the only
// offered way out of the conflict was the way that lost content.
//
// These assert the two things that make it not a dead end: the author's draft SURVIVES,
// and a destructive reload is never the sole offer.
// ---------------------------------------------------------------------------------

const CONFLICT = {
  status: 'conflict' as const,
  baseSha: 'aaaaaaaaaaaa1111',
  headSha: 'bbbbbbbbbbbb2222'
}

function renderEditor(
  mutate: (s: Services) => void = () => {},
  path = '/edit/post/en/release-notes'
) {
  const services = createServices()
  mutate(services)
  render(
    <TooltipProvider>
      <NotificationProvider>
        <MemoryRouter initialEntries={[path]}>
          <ActorProvider>
            <ServicesProvider services={services}>
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
  return services
}

const clickPublish = () =>
  fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))

/** Render, wait for the entry to load, then publish into a conflict. */
async function intoConflict(mutate: (s: Services) => void = () => {}) {
  const services = renderEditor((s) => {
    s.publish = {
      ...s.publish,
      publish: vi.fn(async () => CONFLICT)
    }
    mutate(s)
  })
  await screen.findByDisplayValue('Release notes')
  clickPublish()
  return services
}

describe('#1019 a publish conflict is not a dead end', () => {
  it('explains what moved instead of only saying that something did', async () => {
    await intoConflict()

    await screen.findByRole('alertdialog')
    expect(screen.getByText(/changed since you started editing/i)).toBeTruthy()
    // The two shas the result already carried, and which the old toast threw away.
    expect(screen.getByText('aaaaaaa')).toBeTruthy()
    expect(screen.getByText('bbbbbbb')).toBeTruthy()
  })

  it('offers a NON-destructive way out — reload is not the only action', async () => {
    await intoConflict()
    await screen.findByRole('alertdialog')

    // The primary action keeps the author's work. Its presence is the whole fix.
    expect(
      screen.getByRole('button', { name: /keep my changes/i })
    ).toBeTruthy()
    // Discarding is still available, but only alongside a way to keep the work.
    expect(
      screen.getByRole('button', { name: /discard my changes/i })
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /keep editing/i })).toBeTruthy()
  })

  it("KEEPS the author's draft — the data-loss case", async () => {
    const rebaseDraft = vi.fn(async () => ({
      status: 'rebased' as const,
      baseSha: CONFLICT.headSha,
      baseContent: '---\ntitle: Release notes\n---\n\npublished text\n'
    }))
    const services = await intoConflict((s) => {
      s.publish = { ...s.publish, rebaseDraft }
    })
    await screen.findByRole('alertdialog')

    fireEvent.click(screen.getByRole('button', { name: /keep my changes/i }))

    // Re-forked onto the published version rather than discarded...
    await waitFor(() => expect(rebaseDraft).toHaveBeenCalledOnce())

    // ...and — the assertion that actually matters — the draft still EXISTS afterwards.
    const draft = await services.data.getDraft({
      collection: 'post',
      locale: 'en',
      slug: 'release-notes'
    })
    expect(draft).not.toBeNull()

    // The dialog closes only on success, so a closed dialog means the work was kept.
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('a FAILED recovery stays open and says so, rather than looking like it worked', async () => {
    // §3.2 / §4 #22: the inverse lie is just as bad — a silent failure here would leave the
    // author believing their work was preserved when the re-fork never landed.
    await intoConflict((s) => {
      s.publish = {
        ...s.publish,
        rebaseDraft: vi.fn(() => Promise.reject(new Error('offline')))
      }
    })
    await screen.findByRole('alertdialog')

    fireEvent.click(screen.getByRole('button', { name: /keep my changes/i }))

    // The dialog must NOT close on failure — both options must still be reachable.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /keep my changes/i })
      ).toBeTruthy()
    )
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })
})

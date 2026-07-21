import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { DataPort, DraftInput, EntryRef, IndexService } from '@setu/core'
import { contentPath, serializeMdoc } from '@setu/core'
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

// ---------------------------------------------------------------------------------
// #754 — history restore does not pause autosave. `onRestored` deletes the draft
// so the reload re-forks the restored content from Git HEAD; a debounce firing (or
// a save already in flight) after that delete re-creates the draft with the
// pre-restore buffer, silently resurrecting the discarded edit.
// ---------------------------------------------------------------------------------

const SHA_HEAD = 'a'.repeat(40)
const SHA_OLD = 'b'.repeat(40)
const SHA_RESTORE = 'c'.repeat(40)
const HEAD_CONTENT = '---\ntitle: Hello\n---\nThe slow brown fox.'
const OLD_CONTENT = '---\ntitle: Hello\n---\nThe quick brown fox.'

function stubHistoryFetch() {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200 })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = url
      if (u.includes('/api/capabilities'))
        return json({
          capabilities: {
            imageProcessing: false,
            writableMediaStore: false,
            backgroundJobs: false,
            history: true
          }
        })
      if (u.includes('/api/history/restore')) return json({ sha: SHA_RESTORE })
      if (u.includes('/api/history/file')) {
        const sha = new URL(u, 'http://x').searchParams.get('sha')
        return json({ content: sha === SHA_OLD ? OLD_CONTENT : HEAD_CONTENT })
      }
      if (u.includes('/api/history'))
        return json({
          entries: [
            {
              sha: SHA_HEAD,
              author: 'E2E Admin',
              email: 'admin@setu.test',
              date: new Date().toISOString(),
              subject: 'Publish post/en/hello'
            },
            {
              sha: SHA_OLD,
              author: 'E2E Author',
              email: 'author@setu.test',
              date: new Date(Date.now() - 3_600_000).toISOString(),
              subject: 'Save draft post/en/hello'
            }
          ]
        })
      return new Response('not found', { status: 404 })
    })
  )
}

describe('history restore quiesces autosave (#754)', () => {
  it('a save frozen mid-restore must not resurrect the discarded draft', async () => {
    stubHistoryFetch()
    const helloRef: EntryRef = {
      collection: 'post',
      locale: 'en',
      slug: 'hello'
    }
    const { data, base, arm, releaseGatedSave, gatedEntered } = gatedDataPort()
    const services = servicesFor(
      data,
      createMemoryGitPort([
        {
          path: contentPath(helloRef),
          content: serializeMdoc({
            frontmatter: { title: 'Hello' },
            body: 'The slow brown fox.'
          })
        }
      ])
    )
    renderEditor('/edit/post/en/hello', services)

    const canvas = page.getByLabelText('Content editor')
    await expect
      .element(page.getByText('The slow brown fox.'))
      .toBeInTheDocument()

    // Load's fork-on-open write has landed; arm so the NEXT save (the autosave
    // from typing) is the one that freezes.
    arm()

    // Dirty the buffer → autosave fires and freezes on the gated saveDraft:
    // a save is now in flight with the pre-restore "INTRUDER" buffer.
    await canvas.click()
    await userEvent.keyboard('INTRUDER ')
    await expect.poll(() => gatedEntered(), { timeout: 8000 }).toBe(true)

    // Restore the older revision through the real History panel while that save
    // is still frozen. With the fix, onRestored waits for it to drain and then
    // deletes it; without, the delete happens first and the release re-creates it.
    await page.getByRole('button', { name: 'History', exact: true }).click()
    await page
      .getByRole('button', { name: /Save draft post\/en\/hello/ })
      .click()
    const restoreBtn = page.getByRole('button', {
      name: 'Restore this revision'
    })
    await expect.element(restoreBtn).toBeEnabled()
    await restoreBtn.click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Restore', exact: true })
      .click()

    // Let the frozen save land — after the delete in the buggy ordering.
    releaseGatedSave()

    // The editor re-forked from HEAD — the discarded "INTRUDER" edit is gone from
    // the canvas (exact match: the buggy resurrection shows "INTRUDER The slow…").
    await expect
      .element(page.getByText('The slow brown fox.', { exact: true }), {
        timeout: 8000
      })
      .toBeInTheDocument()
    // And no persisted draft holds the discarded pre-restore buffer. (loadForEdit
    // legitimately re-forks a draft from the restored HEAD, so the draft need not
    // be null — it must simply not be the INTRUDER one the frozen save wrote.)
    await expect
      .poll(
        async () => {
          const d = await base.getDraft(helloRef)
          return d ? JSON.stringify(d.content).includes('INTRUDER') : false
        },
        { timeout: 8000 }
      )
      .toBe(false)
    // Sanity: the restore path really did run through the gated save.
    expect(gatedEntered()).toBe(true)
  }, 25000)
})

// ---------------------------------------------------------------------------------
// #771 — the tab-close window inside the #754 restore. `onRestored` pauses
// autosave, but the beforeunload/unmount flushes never consulted `paused`: an
// edit made while the restore is running left `dirty` set, so closing the tab
// between `deleteDraft` and `resume()` re-created the draft with the pre-restore
// buffer through the flush — defeating the restore by the back door.
// ---------------------------------------------------------------------------------

/** instantIndex, but `reindexEntries` freezes on a gate — which is exactly where
 *  `onRestored` sits AFTER `deleteDraft` and BEFORE `resume()`. That holds the
 *  restore open in its paused window so the test can close the tab inside it. */
function gatedIndex(): { index: IndexService; release: () => void } {
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const index = {
    ...instantIndex(),
    reindexEntries: async (): Promise<void> => {
      await gate
    }
  } as unknown as IndexService
  return { index, release: () => release() }
}

describe('the flushes respect the restore pause (#771)', () => {
  it('closing the tab mid-restore must not re-create the discarded draft', async () => {
    stubHistoryFetch()
    const helloRef: EntryRef = {
      collection: 'post',
      locale: 'en',
      slug: 'hello'
    }
    const base = createMemoryDataPort([])
    const services = servicesFor(
      base,
      createMemoryGitPort([
        {
          path: contentPath(helloRef),
          content: serializeMdoc({
            frontmatter: { title: 'Hello' },
            body: 'The slow brown fox.'
          })
        }
      ])
    )
    const { index, release } = gatedIndex()
    renderEditor('/edit/post/en/hello', services, { index })

    const canvas = page.getByLabelText('Content editor')
    await expect
      .element(page.getByText('The slow brown fox.'))
      .toBeInTheDocument()

    // Restore the older revision through the real History panel. onRestored
    // pauses autosave, deletes the draft, then freezes on the gated reindex —
    // we are now INSIDE the paused window, before resume().
    await page.getByRole('button', { name: 'History', exact: true }).click()
    await page
      .getByRole('button', { name: /Save draft post\/en\/hello/ })
      .click()
    const restoreBtn = page.getByRole('button', {
      name: 'Restore this revision'
    })
    await expect.element(restoreBtn).toBeEnabled()
    await restoreBtn.click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Restore', exact: true })
      .click()

    // A keystroke lands inside that window: the debounce is short-circuited by
    // the pause, but it still marks the buffer dirty.
    await canvas.click()
    await userEvent.keyboard('LATE ')

    // The tab is closed right there. The flush must NOT write under the restore.
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
    await new Promise((r) => setTimeout(r, 50))

    const afterFlush = await base.getDraft(helloRef)
    expect(
      afterFlush ? JSON.stringify(afterFlush.content).includes('LATE') : false
    ).toBe(false)

    // Let the restore finish; the re-fork from HEAD must still win (the restore
    // commit is stubbed at the API, so HEAD in the memory git port is unchanged —
    // the point is that the "LATE " keystroke did not survive as a draft).
    release()
    await expect
      .element(page.getByText('The slow brown fox.', { exact: true }), {
        timeout: 8000
      })
      .toBeInTheDocument()
    await expect
      .poll(
        async () => {
          const d = await base.getDraft(helloRef)
          return d ? JSON.stringify(d.content).includes('LATE') : false
        },
        { timeout: 8000 }
      )
      .toBe(false)
  }, 25000)
})

// ---------------------------------------------------------------------------------
// #755(a) — rename in-flight bypass. `renamingRef` was checked at the TOP of the
// autosave `save`, so a save already PAST that line (in flight) was not blocked:
// followRename deleted the old-ref draft and the in-flight save landed after,
// orphaning a draft at the old slug. The fix awaits the in-flight save before the
// service moves storage.
// ---------------------------------------------------------------------------------

describe('rename awaits the in-flight autosave (#755a)', () => {
  it('a save frozen during rename must not orphan a draft at the old slug', async () => {
    const alphaRef: EntryRef = {
      collection: 'post',
      locale: 'en',
      slug: 'post-alpha'
    }
    const { data, base, arm, releaseGatedSave, gatedEntered } = gatedDataPort()
    const services = servicesFor(
      data,
      createMemoryGitPort([
        {
          path: contentPath(alphaRef),
          content: serializeMdoc({
            frontmatter: { title: 'Alpha' },
            body: 'Alpha body.'
          })
        }
      ])
    )
    renderEditor('/edit/post/en/post-alpha', services)

    const canvas = page.getByLabelText('Content editor')
    await expect.element(page.getByText('Alpha body.')).toBeInTheDocument()

    // Load's fork-on-open write has landed; arm so the autosave is the frozen one.
    arm()

    // Edit → autosave freezes on the gated saveDraft: an autosave for the OLD ref
    // (post-alpha) is now in flight.
    await canvas.click()
    await userEvent.keyboard('EDIT ')
    await expect.poll(() => gatedEntered(), { timeout: 8000 }).toBe(true)

    // Rename via the real Slug field while that save is frozen.
    const slugInput = page.getByRole('textbox', { name: 'Slug' })
    await slugInput.fill('post-renamed')
    await page.getByRole('button', { name: 'Apply slug' }).click()

    // Release the frozen old-ref save. In the buggy ordering it lands after the
    // rename deleted the old draft — the orphan. With the fix, the rename waited.
    releaseGatedSave()

    await expect
      .element(page.getByTestId('loc'), { timeout: 8000 })
      .toHaveTextContent('/edit/post/en/post-renamed')

    // No draft left behind at the OLD slug.
    await expect
      .poll(() => base.getDraft(alphaRef), { timeout: 8000 })
      .toBeNull()
  }, 25000)
})

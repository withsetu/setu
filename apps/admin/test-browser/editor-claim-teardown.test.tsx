import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import type { ReactNode } from 'react'
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate
} from 'react-router-dom'
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
// #549 — the first-autosave slug claim must NOT tear down the editor screen.
//
// On a brand-new post the first autosave mints the slug and navigates
// /edit/.../new → /edit/.../<slug>. Before the fix, two mechanisms rebuilt the
// whole editor stage on that self-initiated navigation: the load effect cycled
// setPhase('loading') (whose early-return swaps the entire screen for "Loading…"
// and back), and Canvas/MetaPanel were keyed by slug. Net effect ~600ms after the
// user's first edit: an open dialog silently closes, editor focus and scroll are
// dropped. These are timing/portal/focus behaviors jsdom cannot express (CLAUDE.md
// failure mode #3) — hence real chromium, real Tiptap, real Radix portals.
//
// The last two tests pin the PRESERVED semantics: a real entry switch still
// remounts the keyed subtrees (#366 — per-entry field snapshots must not leak),
// and a history-restore reloadKey bump (#466) still remounts + re-forks from HEAD.
// ---------------------------------------------------------------------------------

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function LocationProbe() {
  return <div data-testid="loc">{useLocation().pathname}</div>
}

function NavButton({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(to)}>
      {label}
    </button>
  )
}

function renderEditor(path: string, services: Services, extra?: ReactNode) {
  return render(
    <TooltipProvider>
      <NotificationProvider>
        <MemoryRouter initialEntries={[path]}>
          <ActorProvider>
            <ServicesProvider services={services}>
              <AppMediaIndexProvider>
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
                        <LocationProbe />
                        {extra}
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

function composeServices(): Services {
  return servicesFor(createMemoryDataPort(), createMemoryGitPort([]))
}

/** Wait until the compose-mint claim has landed (URL carries the minted slug)
 *  and its load effect has settled. The extra beat matters for the RED case:
 *  the pre-fix teardown happens in the load effect right after the navigation,
 *  so asserting immediately at the URL flip could race past it. */
async function claimSettled(mintedPath: string) {
  await expect
    .element(page.getByTestId('loc'), { timeout: 8000 })
    .toHaveTextContent(mintedPath)
  await new Promise((r) => setTimeout(r, 700))
}

describe('compose-mint slug claim keeps the editor mounted (#549)', () => {
  it('the editor stage and canvas DOM nodes survive the first-autosave claim', async () => {
    renderEditor('/edit/post/en/new', composeServices())

    const canvas = page.getByLabelText('Content editor')
    await expect.element(canvas).toBeInTheDocument()

    // First edit → the ~800ms debounced autosave mints the slug and navigates.
    // ('Title' alone is ambiguous with the rail's 'SEO title' — match exactly.)
    await page
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill('Claim Survivor')

    // Sentinels: the stage div catches the setPhase('loading') full-screen swap;
    // the ProseMirror element catches a keyed Canvas remount.
    const stageEl = document.querySelector<HTMLElement>('.editor-stage')
    expect(stageEl).not.toBeNull()
    stageEl!.dataset['sentinel549'] = 'alive'
    const canvasEl = canvas.element() as HTMLElement

    await claimSettled('/edit/post/en/claim-survivor')

    // Same nodes, still mounted — the claim did not rebuild the screen.
    expect(stageEl!.isConnected).toBe(true)
    expect(document.querySelector<HTMLElement>('.editor-stage')).toBe(stageEl)
    expect(stageEl!.dataset['sentinel549']).toBe('alive')
    expect(canvasEl.isConnected).toBe(true)
  }, 15000)

  it('editor focus and the typed text survive the claim while typing', async () => {
    renderEditor('/edit/post/en/new', composeServices())

    const canvas = page.getByLabelText('Content editor')
    await expect.element(canvas).toBeInTheDocument()

    // Type straight into the canvas (empty title → the mint falls back to
    // "untitled"). This is the first edit, so it arms the debounced claim.
    await canvas.click()
    await userEvent.keyboard('Hello from before the claim')
    const canvasEl = canvas.element() as HTMLElement
    expect(document.activeElement).toBe(canvasEl)

    await claimSettled('/edit/post/en/untitled')

    // Focus never left the canvas — the user can just keep typing.
    expect(document.activeElement).toBe(canvasEl)
    await userEvent.keyboard(' and after it')
    await expect
      .element(page.getByText('Hello from before the claim and after it'))
      .toBeInTheDocument()
  }, 15000)

  it('a dialog opened in the rail just before the claim is still open after it', async () => {
    renderEditor('/edit/post/en/new', composeServices())

    await expect
      .element(page.getByLabelText('Content editor'))
      .toBeInTheDocument()
    await page
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill('Dialog Stays Open')

    // Inside the debounce window: open the featured-image picker (a real Radix
    // Dialog in the MetaPanel rail — its open flag lives in FeaturedImageField
    // state, which a remount would destroy).
    // .first(): the SEO section renders a second identical picker button.
    await page
      .getByRole('button', { name: 'Set featured image' })
      .first()
      .click()
    const dialog = page.getByRole('dialog', { name: 'Add an image' })
    await expect.element(dialog).toBeInTheDocument()
    const dialogEl = dialog.element() as HTMLElement

    await claimSettled('/edit/post/en/dialog-stays-open')

    // The same dialog is still open — the claim didn't silently close it.
    expect(dialogEl.isConnected).toBe(true)
    await expect
      .element(page.getByRole('dialog', { name: 'Add an image' }))
      .toBeInTheDocument()
  }, 15000)
})

// --- preserved remount semantics -------------------------------------------------

const alphaRef = { collection: 'post', locale: 'en', slug: 'post-alpha' }
const betaRef = { collection: 'post', locale: 'en', slug: 'post-beta' }

describe('remount semantics preserved by the #549 fix', () => {
  it('navigating to a DIFFERENT entry still remounts the canvas (#366)', async () => {
    const services = servicesFor(
      createMemoryDataPort(),
      createMemoryGitPort([
        {
          path: contentPath(alphaRef),
          content: serializeMdoc({
            frontmatter: { title: 'Alpha' },
            body: 'Alpha body stays put.'
          })
        },
        {
          path: contentPath(betaRef),
          content: serializeMdoc({
            frontmatter: { title: 'Beta' },
            body: 'Beta body stays put.'
          })
        }
      ])
    )
    renderEditor(
      '/edit/post/en/post-alpha',
      services,
      <NavButton to="/edit/post/en/post-beta" label="go-to-beta" />
    )

    await expect
      .element(page.getByText('Alpha body stays put.'))
      .toBeInTheDocument()
    const canvasEl = page.getByLabelText('Content editor').element()

    await page.getByRole('button', { name: 'go-to-beta' }).click()
    await expect
      .element(page.getByText('Beta body stays put.'), { timeout: 8000 })
      .toBeInTheDocument()

    // A real entry switch is a fresh mount: no per-entry state may leak (#366).
    expect(canvasEl.isConnected).toBe(false)
    expect(page.getByText('Alpha body stays put.').elements().length).toBe(0)
  }, 15000)

  it('a history-restore reloadKey bump still remounts and re-forks from HEAD (#466)', async () => {
    const SHA_HEAD = 'a'.repeat(40)
    const SHA_OLD = 'b'.repeat(40)
    const SHA_RESTORE = 'c'.repeat(40)
    const HEAD_CONTENT = '---\ntitle: Hello\n---\nThe slow brown fox.'
    const OLD_CONTENT = '---\ntitle: Hello\n---\nThe quick brown fox.'
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
        if (u.includes('/api/history/restore'))
          return json({ sha: SHA_RESTORE })
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

    const helloRef = { collection: 'post', locale: 'en', slug: 'hello' }
    const services = servicesFor(
      createMemoryDataPort(),
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

    // Dirty the buffer and let autosave settle so no debounce timer can race
    // the restore's draft deletion.
    await canvas.click()
    await userEvent.keyboard('INTRUDER ')
    await expect
      .element(page.getByText('Backed up on this device'), { timeout: 8000 })
      .toBeInTheDocument()
    const canvasEl = canvas.element() as HTMLElement

    // Restore the older revision through the real History panel.
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

    // The restore MUST remount: the old canvas node is gone and the content
    // re-forked from Git HEAD — the dirty keystrokes are discarded (#466).
    // Polls, not instant asserts: the closing Sheet's exit animation keeps its
    // diff text (which contains the typed word) in the DOM for a beat.
    await expect.poll(() => canvasEl.isConnected, { timeout: 8000 }).toBe(false)
    await expect
      .element(page.getByText('The slow brown fox.', { exact: true }), {
        timeout: 8000
      })
      .toBeInTheDocument()
    await expect
      .poll(() => page.getByText(/INTRUDER/).elements().length, {
        timeout: 8000
      })
      .toBe(0)
  }, 20000)
})

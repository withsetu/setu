import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Actor, TiptapDoc } from '@setu/core'
import { contentPath, serializeMdoc } from '@setu/core'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import type { Services } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'
import { NotificationProvider } from '../src/ui/notify'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { CommandRegistryProvider } from '../src/command/registry'

const ref = { collection: 'post', locale: 'en', slug: 'hello' }
const SHA_HEAD = 'a'.repeat(40)

/** Stub global fetch (apiFetch's primitive — the users-screen.test.tsx pattern)
 *  for `/api/capabilities` (useCapabilities) and the history list the panel
 *  loads when opened. */
function stubCapabilities(history: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = url
      if (u.includes('/api/capabilities')) {
        return new Response(
          JSON.stringify({
            capabilities: {
              imageProcessing: false,
              writableMediaStore: false,
              backgroundJobs: false,
              history
            }
          }),
          { status: 200 }
        )
      }
      if (u.includes('/api/history/file')) {
        return new Response(
          JSON.stringify({ content: '---\ntitle: Hello\n---\nx' }),
          { status: 200 }
        )
      }
      if (u.includes('/api/history?') || u.endsWith('/api/history')) {
        return new Response(
          JSON.stringify({
            entries: [
              {
                sha: SHA_HEAD,
                author: 'E2E Admin',
                email: 'admin@setu.test',
                date: new Date().toISOString(),
                subject: 'Publish post/en/hello'
              },
              {
                sha: 'b'.repeat(40),
                author: 'E2E Author',
                email: 'author@setu.test',
                date: new Date(Date.now() - 3_600_000).toISOString(),
                subject: 'Save draft post/en/hello'
              }
            ]
          }),
          { status: 200 }
        )
      }
      return new Response('not found', { status: 404 })
    })
  )
}

function servicesWithCommitted(frontmatter: Record<string, unknown>): Services {
  const seed = [
    {
      path: contentPath(ref),
      content: serializeMdoc({ frontmatter, body: 'x' })
    }
  ]
  return servicesFor(createMemoryDataPort(), createMemoryGitPort(seed))
}

/** A draft-only entry: nothing in Git — the no-history case. */
async function servicesWithDraftOnly(): Promise<Services> {
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort([]))
  const doc: TiptapDoc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }]
  }
  await services.data.saveDraft({
    ...ref,
    content: doc,
    metadata: { title: 'Hello' },
    baseSha: null
  })
  return services
}

function renderEditor(services: Services, actor: Actor) {
  return render(
    <TooltipProvider>
      <NotificationProvider>
        <MemoryRouter initialEntries={[`/edit/post/en/${ref.slug}`]}>
          <ActorProvider actor={actor}>
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
}

afterEach(() => vi.unstubAllGlobals())

describe('EditorScreen History button gating (#466)', () => {
  it('shows the History button for a committed entry when the capability is on', async () => {
    stubCapabilities(true)
    renderEditor(servicesWithCommitted({ title: 'Hello' }), {
      id: 'e1',
      role: 'editor'
    })
    await screen.findByDisplayValue('Hello')
    expect(
      await screen.findByRole('button', { name: 'History' })
    ).toBeInTheDocument()
  })

  it('opens the revision-history panel on click', async () => {
    stubCapabilities(true)
    renderEditor(servicesWithCommitted({ title: 'Hello' }), {
      id: 'e1',
      role: 'editor'
    })
    await screen.findByDisplayValue('Hello')
    fireEvent.click(await screen.findByRole('button', { name: 'History' }))
    expect(
      await screen.findByRole('dialog', { name: 'History' })
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('list', { name: 'Revisions' })
    ).toBeInTheDocument()
  })

  it('hides the button when the server lacks the history capability', async () => {
    stubCapabilities(false)
    renderEditor(servicesWithCommitted({ title: 'Hello' }), {
      id: 'e1',
      role: 'editor'
    })
    await screen.findByDisplayValue('Hello')
    expect(
      screen.queryByRole('button', { name: 'History' })
    ).not.toBeInTheDocument()
  })

  it('hides the button for a never-committed entry (no history to show)', async () => {
    stubCapabilities(true)
    renderEditor(await servicesWithDraftOnly(), { id: 'e1', role: 'editor' })
    await screen.findByDisplayValue('Hello')
    expect(
      screen.queryByRole('button', { name: 'History' })
    ).not.toBeInTheDocument()
  })

  it('author on a live post: panel opens but restore is disabled with the role reason', async () => {
    stubCapabilities(true)
    renderEditor(servicesWithCommitted({ title: 'Hello' }), {
      id: 'a1',
      role: 'author'
    })
    await screen.findByDisplayValue('Hello')
    fireEvent.click(await screen.findByRole('button', { name: 'History' }))
    await screen.findByRole('dialog', { name: 'History' })
    // The honest-denial posture (card #5): restore renders DISABLED with the
    // role reason instead of hiding — the server's 403 is the real gate.
    const restore = await screen.findByRole('button', {
      name: 'Restore this revision'
    })
    expect(restore).toBeDisabled()
    expect(
      screen.getByText("Your role can't change published posts")
    ).toBeInTheDocument()
  })
})

describe('EditorScreen History with a dirty buffer (#466 owner UAT)', () => {
  it('typed-but-uncommitted edits pin the unsaved-changes row above the commits', async () => {
    stubCapabilities(true)
    renderEditor(servicesWithCommitted({ title: 'Hello' }), {
      id: 'e1',
      role: 'editor'
    })
    const title = await screen.findByDisplayValue('Hello')
    // The owner repro: type, then open History before any commit.
    fireEvent.change(title, { target: { value: 'Hello v2' } })
    fireEvent.click(await screen.findByRole('button', { name: 'History' }))

    const panel = await screen.findByRole('dialog', { name: 'History' })
    const unsaved = await within(panel).findByRole('button', {
      name: /Your unsaved changes/
    })
    expect(unsaved).toHaveTextContent('now')
    expect(await within(panel).findByText('Last commit')).toBeInTheDocument()
    expect(within(panel).queryByText('Current')).not.toBeInTheDocument()
  })

  it('a clean buffer keeps the Current badge and shows no unsaved row', async () => {
    stubCapabilities(true)
    renderEditor(servicesWithCommitted({ title: 'Hello' }), {
      id: 'e1',
      role: 'editor'
    })
    await screen.findByDisplayValue('Hello')
    fireEvent.click(await screen.findByRole('button', { name: 'History' }))

    const panel = await screen.findByRole('dialog', { name: 'History' })
    // The preselected revision equals the buffer — once its diff settles the
    // HEAD fetch (same batch) has too, so dirtiness is decided.
    expect(await within(panel).findByText(/No differences/)).toBeInTheDocument()
    expect(
      within(panel).queryByText('Your unsaved changes')
    ).not.toBeInTheDocument()
    expect(within(panel).getByText('Current')).toBeInTheDocument()
  })
})

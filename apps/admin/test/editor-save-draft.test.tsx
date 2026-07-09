import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Actor } from '@setu/core'
import { contentPath, parseMdoc, serializeMdoc } from '@setu/core'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import {
  ServicesProvider,
  createServices,
  servicesFor
} from '../src/data/store'
import type { Services } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'
import { NotificationProvider } from '../src/ui/notify'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { CommandRegistryProvider } from '../src/command/registry'

// Radix DropdownMenu calls scrollIntoView when it opens — stub it for jsdom.
beforeAll(() => {
  if (
    typeof window !== 'undefined' &&
    !window.HTMLElement.prototype.scrollIntoView
  ) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
})

const ENTRY = { collection: 'post', locale: 'en', slug: 'release-notes' }
const draftRef = { collection: 'post', locale: 'en', slug: 'draft-post' }

/** Build a services bundle with a single committed entry seeded in Git (no
 *  matching draft in the DataPort) — same helper shape as editor-viewonly.test.tsx. */
function servicesWithCommitted(
  entryRef: typeof draftRef,
  frontmatter: Record<string, unknown>
): Services {
  const seed = [
    {
      path: contentPath(entryRef),
      content: serializeMdoc({ frontmatter, body: 'x' })
    }
  ]
  return servicesFor(createMemoryDataPort(), createMemoryGitPort(seed))
}

function renderEditor(
  services: Services,
  actor: Actor,
  path = '/edit/post/en/release-notes'
): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <NotificationProvider>
        <MemoryRouter initialEntries={[path]}>
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

describe('EditorScreen Save draft (#382)', () => {
  it('author on a new draft sees Save draft (no Publish); clicking commits published:false', async () => {
    const services = createServices()
    renderEditor(services, { id: 'a1', role: 'author' })
    await screen.findByDisplayValue('Release notes')

    expect(
      screen.getByRole('button', { name: /^save draft$/i })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^publish$/i })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^save draft$/i }))

    await waitFor(async () => {
      const file = await services.git.readFile(contentPath(ENTRY))
      expect(file).not.toBeNull()
      expect(parseMdoc(file as string).frontmatter['published']).toBe(false)
    })
    expect(
      await screen.findByText(/^Draft saved · [0-9a-f]{7}$/)
    ).toBeInTheDocument()
  })

  it('editor on a draft entry sees BOTH Save draft and Publish', async () => {
    // Never-committed entry: liveCommitted is false, editor holds both content.edit
    // and content.publish, so both actions are on offer.
    const services = createServices()
    renderEditor(services, { id: 'e1', role: 'editor' })
    await screen.findByDisplayValue('Release notes')

    expect(
      screen.getByRole('button', { name: /^save draft$/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^publish$/i })
    ).toBeInTheDocument()

    // Publishing must refresh `liveCommitted` in place: Save draft disappears
    // without a reload once the entry goes live.
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    await screen.findByText(/^Published · [0-9a-f]{7}$/)
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /^save draft$/i })
      ).not.toBeInTheDocument()
    )
  })

  it('publisher on a LIVE entry sees no Save draft (Publish menu as today)', async () => {
    const services = servicesWithCommitted(draftRef, { title: 'Live Post' })
    renderEditor(
      services,
      { id: 'e1', role: 'editor' },
      '/edit/post/en/draft-post'
    )
    await screen.findByDisplayValue('Live Post')

    expect(
      screen.queryByRole('button', { name: /^save draft$/i })
    ).not.toBeInTheDocument()
    // Publish menu (Publish button) still renders as today for a live entry —
    // Save draft is the only thing gated off.
    expect(
      screen.getByRole('button', { name: /^publish$/i })
    ).toBeInTheDocument()
  })

  it('Save draft keeps the entry a draft after reopen (published stays false)', async () => {
    const services = createServices()
    const first = renderEditor(services, { id: 'a1', role: 'author' })
    await screen.findByDisplayValue('Release notes')
    fireEvent.click(screen.getByRole('button', { name: /^save draft$/i }))
    await waitFor(async () => {
      const file = await services.git.readFile(contentPath(ENTRY))
      expect(file).not.toBeNull()
      expect(parseMdoc(file as string).frontmatter['published']).toBe(false)
    })
    first.unmount()

    // Reopen the SAME entry against the SAME services (simulates navigating back in).
    renderEditor(services, { id: 'a1', role: 'author' })
    await screen.findByDisplayValue('Release notes')

    // Still a draft: Save draft is offered again (liveCommitted is still false), no
    // Publish-only state snuck in.
    expect(
      screen.getByRole('button', { name: /^save draft$/i })
    ).toBeInTheDocument()
    const file = await services.git.readFile(contentPath(ENTRY))
    expect(file).not.toBeNull()
    expect(parseMdoc(file as string).frontmatter['published']).toBe(false)
  })
})

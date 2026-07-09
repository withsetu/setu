import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Actor } from '@setu/core'
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

const ref = { collection: 'post', locale: 'en', slug: 'live-post' }
const draftRef = { collection: 'post', locale: 'en', slug: 'draft-post' }

/** Build a services bundle with a single committed entry seeded in Git (no
 *  matching draft in the DataPort) — the same shape `loadForEdit` forks from. */
function servicesWithCommitted(
  entryRef: typeof ref,
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
  path: string
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

afterEach(() => vi.useRealTimers())

describe('EditorScreen view-only for non-publishers on live posts (#382)', () => {
  it('author opening a live post gets view-only: banner, disabled title, no actions', async () => {
    const services = servicesWithCommitted(ref, { title: 'Live Post' })
    renderEditor(
      services,
      { id: 'a1', role: 'author' },
      '/edit/post/en/live-post'
    )

    await screen.findByDisplayValue('Live Post')

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent(/This post is live/)

    expect(screen.getByRole('textbox', { name: 'Title' })).toBeDisabled()

    expect(
      screen.queryByRole('button', { name: /^publish$/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /save draft/i })
    ).not.toBeInTheDocument()
  })

  it('author opening a committed DRAFT (published:false) can edit — no banner', async () => {
    const services = servicesWithCommitted(draftRef, {
      title: 'Draft Post',
      published: false
    })
    renderEditor(
      services,
      { id: 'a1', role: 'author' },
      '/edit/post/en/draft-post'
    )

    await screen.findByDisplayValue('Draft Post')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Title' })).not.toBeDisabled()
  })

  it('editor role opening a live post edits normally — no banner', async () => {
    const services = servicesWithCommitted(ref, { title: 'Live Post' })
    renderEditor(
      services,
      { id: 'e1', role: 'editor' },
      '/edit/post/en/live-post'
    )

    await screen.findByDisplayValue('Live Post')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Title' })).not.toBeDisabled()
  })

  it('typing is impossible in view-only: no autosave fires', async () => {
    vi.useFakeTimers()
    const services = servicesWithCommitted(ref, { title: 'Live Post' })
    const saveSpy = vi.spyOn(services.authoring, 'save')
    renderEditor(
      services,
      { id: 'a1', role: 'author' },
      '/edit/post/en/live-post'
    )

    await vi.waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
        'Live Post'
      )
    )

    const titleInput = screen.getByRole('textbox', { name: 'Title' })
    fireEvent.change(titleInput, { target: { value: 'Changed' } })
    await vi.advanceTimersByTimeAsync(1000)

    expect(saveSpy).not.toHaveBeenCalled()
    expect(screen.getByText('Read-only')).toBeInTheDocument()
  })
})

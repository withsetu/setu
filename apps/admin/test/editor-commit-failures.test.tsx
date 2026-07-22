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
// #798 — Publish / Save draft / Unpublish must never be silently inert. `commit()`
// had no `catch` and every call site was a bare `void commit()`, so an offline or
// 5xx save produced no toast, no error and no state change: the author had every
// reason to believe the post was live. Two siblings shared the silence — the
// `{ status: 'nothing' }` publish result hit no branch, and a refused save
// (`{ saved: false }`, draft lock held elsewhere) fell through to publish, which
// reads STORAGE and would commit someone else's draft under a "Published" toast.
// ---------------------------------------------------------------------------------

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

describe('#798 a failed commit is never silent', () => {
  it('surfaces an error and does not claim success when the save rejects', async () => {
    const publish = vi.fn()
    renderEditor((s) => {
      s.authoring = {
        ...s.authoring,
        save: () => Promise.reject(new Error('offline'))
      }
      s.publish = {
        publish: (...args: Parameters<typeof s.publish.publish>) => {
          publish(...args)
          return Promise.reject(new Error('should never be reached'))
        }
      }
    })
    await screen.findByDisplayValue('Release notes')

    clickPublish()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't publish/i)
    expect(screen.queryByText(/Published ·/)).not.toBeInTheDocument()
    expect(publish).not.toHaveBeenCalled()
  })

  it('surfaces an error when publish reports there was nothing to commit', async () => {
    renderEditor((s) => {
      s.publish = { publish: () => Promise.resolve({ status: 'nothing' }) }
    })
    await screen.findByDisplayValue('Release notes')

    clickPublish()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/draft could not be found/i)
    expect(screen.queryByText(/Published ·/)).not.toBeInTheDocument()
  })

  it('does not publish when the save was refused — that would commit another editor’s draft', async () => {
    const publish = vi.fn()
    renderEditor((s) => {
      const lock = {
        collection: 'post',
        locale: 'en',
        slug: 'release-notes',
        lockedBy: 'someone-else',
        lockedAt: Date.now()
      }
      s.authoring = {
        ...s.authoring,
        save: () =>
          Promise.resolve({
            saved: false as const,
            outcome: 'blocked' as const,
            lock,
            draft: null
          })
      }
      s.publish = {
        publish: (...args: Parameters<typeof s.publish.publish>) => {
          publish(...args)
          return Promise.reject(new Error('should never be reached'))
        }
      }
    })
    await screen.findByDisplayValue('Release notes')

    clickPublish()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/locked by another editor/i)
    expect(publish).not.toHaveBeenCalled()
    expect(screen.queryByText(/Published ·/)).not.toBeInTheDocument()
  })

  it('reports the action the author actually took (Save draft, not Publish)', async () => {
    renderEditor((s) => {
      s.authoring = {
        ...s.authoring,
        save: () => Promise.reject(new Error('offline'))
      }
    })
    await screen.findByDisplayValue('Release notes')

    fireEvent.click(screen.getByRole('button', { name: /save draft/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't save the draft/i)
  })
})

describe('#798 a refused save-before-rename does not move the entry', () => {
  it('refuses the rename instead of renaming around an unsaved buffer', async () => {
    const renamed = vi.fn()
    const services = renderEditor((s) => {
      const lock = {
        collection: 'post',
        locale: 'en',
        slug: 'release-notes',
        lockedBy: 'someone-else',
        lockedAt: Date.now()
      }
      s.authoring = {
        ...s.authoring,
        save: () =>
          Promise.resolve({
            saved: false as const,
            outcome: 'blocked' as const,
            lock,
            draft: null
          })
      }
    })
    // The rename service is built inside the screen from data+git; spy on the git
    // write it would have to make (renameSlug moves the committed file with
    // `commitFiles`) and on the draft re-key that follows it.
    services.git.commitFiles = () => {
      renamed()
      return Promise.reject(new Error('should never be reached'))
    }
    services.data.deleteDraft = () => {
      renamed()
      return Promise.reject(new Error('should never be reached'))
    }
    await screen.findByDisplayValue('Release notes')

    const slug = screen.getByLabelText('Slug')
    fireEvent.change(slug, { target: { value: 'moved-notes' } })
    fireEvent.keyDown(slug, { key: 'Enter' })

    await waitFor(() =>
      expect(screen.getByText(/locked by another editor/i)).toBeInTheDocument()
    )
    expect(renamed).not.toHaveBeenCalled()
  })
})

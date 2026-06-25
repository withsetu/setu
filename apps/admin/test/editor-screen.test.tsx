import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Draft, TiptapDoc } from '@setu/core'
import { createBulkService, createMediaIndexService } from '@setu/core'
import { createMemoryIndexPort, createMemoryMediaIndexPort } from '@setu/db-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, createServices } from '../src/data/store'
import type { Services } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'
import { NotificationProvider } from '../src/ui/notify'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { CommandRegistryProvider } from '../src/command/registry'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const aDraft: Draft = { collection: 'post', locale: 'en', slug: 'p1', content: doc('Hello body'), metadata: { title: 'Hello', status: 'draft' }, baseSha: null, createdAt: 0, updatedAt: 0 }
const aLock = { collection: 'post', locale: 'en', slug: 'p1', lockedBy: 'local', lockedAt: 0 }

function fakeServices(over: Partial<Services> = {}): Services {
  const save = vi.fn(async (input: { metadata: Record<string, unknown> }) => ({ saved: true, outcome: 'refreshed', lock: aLock, draft: { ...aDraft, ...input } }))
  const data = { getDraft: vi.fn(async () => aDraft) } as unknown as Services['data']
  const git = { readFile: vi.fn(async () => null) } as unknown as Services['git']
  const read = { loadForEdit: vi.fn(async () => ({ source: 'draft', draft: aDraft })) } as unknown as Services['read']
  return {
    data,
    git,
    read,
    authoring: {
      open: vi.fn(async () => ({ granted: true, outcome: 'acquired', lock: aLock, draft: aDraft })),
      save,
      release: vi.fn(), forceUnlock: vi.fn(), status: vi.fn(),
    } as unknown as Services['authoring'],
    publish: { publish: vi.fn(async () => ({ status: 'nothing' as const })) } as unknown as Services['publish'],
    index: createMemoryIndexPort(),
    bulk: createBulkService({ data, git, read, author: { name: 'T', email: 't@x.com' } }),
    mediaIndex: createMediaIndexService({ mediaIndex: createMemoryMediaIndexPort(), fetchRaw: async () => [] }),
    ...over,
  }
}

function renderEditor(services: Services, path = '/edit/post/en/p1') {
  return render(
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
                        <Route path="/edit/:collection/:locale/:slug" element={<EditorScreen />} />
                      </Routes>
                    </CommandRegistryProvider>
                  </TaxonomyProvider>
                </IndexProvider>
              </DeployProvider>
            </ServicesProvider>
          </ActorProvider>
        </MemoryRouter>
      </NotificationProvider>
    </TooltipProvider>,
  )
}

afterEach(() => vi.useRealTimers())

describe('EditorScreen', () => {
  it('loads a draft and renders its title', async () => {
    renderEditor(fakeServices())
    expect(await screen.findByDisplayValue('Hello')).toBeInTheDocument()
  })

  it('opens a blank canvas for an absent entry', async () => {
    const services = fakeServices({ read: { loadForEdit: vi.fn(async () => ({ source: 'absent' })) } as unknown as Services['read'] })
    renderEditor(services, '/edit/post/en/new')
    expect(await screen.findByLabelText('Title')).toHaveValue('')
  })

  it('renders read-only with a banner when the lock is blocked', async () => {
    const services = fakeServices()
    ;(services.authoring.open as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ granted: false, outcome: 'blocked', lock: { ...aLock, lockedBy: 'someone' }, draft: aDraft })
    renderEditor(services)
    expect(await screen.findByText(/locked by another editor/i)).toBeInTheDocument()
  })

  it('autosave → Saved: editing the title calls authoring.save and shows "Saved"', async () => {
    vi.useFakeTimers()
    const services = fakeServices()
    renderEditor(services)
    // Wait for the editor to be ready (title renders with its initial value)
    await vi.waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Hello'))
    const titleInput = screen.getByLabelText('Title')
    // Simulate a user edit that triggers onMetaChange → rev bump → autosave debounce
    fireEvent.change(titleInput, { target: { value: 'Hello edited' } })
    // Advance past the 800 ms debounce so useAutosave fires
    await vi.advanceTimersByTimeAsync(800)
    // The save fn must have been called
    expect(services.authoring.save).toHaveBeenCalled()
    // After the async save resolves, SaveIndicator must display "Saved"
    await vi.waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
  })

  it('persists across a reopen (real services)', async () => {
    const services = createServices()
    const { unmount } = renderEditor(services, '/edit/post/en/release-notes')
    await screen.findByDisplayValue('Release notes')
    // Mutate the title and wait for autosave to persist it before remounting
    const titleInput = screen.getByLabelText('Title')
    fireEvent.change(titleInput, { target: { value: 'Release notes v2' } })
    expect(screen.getByLabelText('Title')).toHaveValue('Release notes v2')
    // Wait for the autosave to fire and persist the new title value
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument(), { timeout: 2000 })
    unmount()
    renderEditor(services, '/edit/post/en/release-notes')
    // The persisted value must survive the remount (real in-memory services reload it)
    expect(await screen.findByDisplayValue('Release notes v2')).toBeInTheDocument()
  })

  it('strip renders Back link and Keyboard-shortcuts button', async () => {
    renderEditor(fakeServices())
    await screen.findByDisplayValue('Hello')
    // Back to list — rendered as a link (Button asChild + Link)
    expect(screen.getByRole('link', { name: 'Back to list' })).toBeInTheDocument()
    // Keyboard shortcuts button
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })

  it('strip shows Publish button when canPublish is true', async () => {
    renderEditor(fakeServices())
    await screen.findByDisplayValue('Hello')
    // PublishMenu renders a Publish button when canPublish is true (default fakeServices grants content.publish)
    expect(screen.getByRole('button', { name: /^publish$/i })).toBeInTheDocument()
  })
})

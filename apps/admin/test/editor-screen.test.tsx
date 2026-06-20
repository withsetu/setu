import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Draft, TiptapDoc } from '@setu/core'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, createServices } from '../src/data/store'
import type { Services } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { EditorScreen } from '../src/editor/EditorScreen'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const aDraft: Draft = { collection: 'post', locale: 'en', slug: 'p1', content: doc('Hello body'), metadata: { title: 'Hello', status: 'draft' }, baseSha: null, createdAt: 0, updatedAt: 0 }
const aLock = { collection: 'post', locale: 'en', slug: 'p1', lockedBy: 'local', lockedAt: 0 }

function fakeServices(over: Partial<Services> = {}): Services {
  const save = vi.fn(async (input: { metadata: Record<string, unknown> }) => ({ saved: true, outcome: 'refreshed', lock: aLock, draft: { ...aDraft, ...input } }))
  return {
    data: { getDraft: vi.fn(async () => aDraft) } as unknown as Services['data'],
    git: { readFile: vi.fn(async () => null) } as unknown as Services['git'],
    read: { loadForEdit: vi.fn(async () => ({ source: 'draft', draft: aDraft })) } as unknown as Services['read'],
    authoring: {
      open: vi.fn(async () => ({ granted: true, outcome: 'acquired', lock: aLock, draft: aDraft })),
      save,
      release: vi.fn(), forceUnlock: vi.fn(), status: vi.fn(),
    } as unknown as Services['authoring'],
    publish: { publish: vi.fn(async () => ({ status: 'nothing' as const })) } as unknown as Services['publish'],
    ...over,
  }
}

function renderEditor(services: Services, path = '/edit/post/en/p1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ActorProvider>
        <ServicesProvider services={services}>
          <DeployProvider>
            <IndexProvider>
              <Routes>
                <Route path="/edit/:collection/:locale/:slug" element={<EditorScreen />} />
              </Routes>
            </IndexProvider>
          </DeployProvider>
        </ServicesProvider>
      </ActorProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.useRealTimers())

describe('EditorScreen', () => {
  it('loads a draft and renders its title + status', async () => {
    renderEditor(fakeServices())
    expect(await screen.findByDisplayValue('Hello')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draft' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('changing the status autosaves and flips the indicator to Saved', async () => {
    const services = fakeServices()
    renderEditor(services)
    await screen.findByDisplayValue('Hello')
    fireEvent.click(screen.getByRole('button', { name: 'Staged' }))
    await waitFor(() => expect(services.authoring.save).toHaveBeenCalled())
    const calls = (services.authoring.save as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.at(-1)?.[0].metadata.status).toBe('staged')
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
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
    expect(screen.getByRole('button', { name: 'Draft' })).toBeDisabled()
  })

  it('persists across a reopen (real services)', async () => {
    const services = createServices()
    const { unmount } = renderEditor(services, '/edit/post/en/release-notes')
    await screen.findByDisplayValue('Release notes')
    fireEvent.click(screen.getByRole('button', { name: 'Staged' }))
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument(), { timeout: 3000 })
    unmount()
    renderEditor(services, '/edit/post/en/release-notes')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Staged' })).toHaveAttribute('aria-pressed', 'true'))
  })
})

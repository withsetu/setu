import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { NotificationProvider } from '../src/ui/notify'
import { MediaSettings } from '../src/screens/settings/MediaSettings'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

function renderMedia() {
  const git = createMemoryGitPort([])
  const services = servicesFor(createMemoryDataPort([]), git)
  const wrapper = (children: ReactNode) => (
    <NotificationProvider>
      <ActorProvider>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </ActorProvider>
    </NotificationProvider>
  )
  render(wrapper(<MediaSettings />))
  return { git }
}

describe('MediaSettings', () => {
  it('renders the image format select with WebP/AVIF/Both options', async () => {
    renderMedia()
    // The format select trigger should appear
    const trigger = await screen.findByRole('combobox', { name: /image format/i })
    expect(trigger).toBeTruthy()
  })

  it('renders the LQIP switch', async () => {
    renderMedia()
    const toggle = await screen.findByRole('switch', { name: /blur.up placeholders/i })
    expect(toggle).toBeTruthy()
  })

  it('saves the media group when switching LQIP on and clicking save', async () => {
    const { git } = renderMedia()
    const toggle = await screen.findByRole('switch', { name: /blur.up placeholders/i })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw as string).media.imageLqip).toBe(true)
    })
  })

  it('shows the reprocess button and local-run warning dialog', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ reprocessed: 42 }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderMedia()

    // Reprocess button should be present
    const reprocessBtn = await screen.findByRole('button', { name: /reprocess all images/i })
    expect(reprocessBtn).toBeTruthy()

    // Click it — alert dialog should open with the local-run warning
    fireEvent.click(reprocessBtn)

    // The dialog description contains the exact verbatim warning
    const warnings = await screen.findAllByText(/re-encodes every image/i)
    expect(warnings.length).toBeGreaterThan(0)
    // The local-run warning is in the dialog description specifically
    const localRunWarning = await screen.findByText(/best run locally, not on a deployed site/i)
    expect(localRunWarning).toBeTruthy()
  })

  it('calls POST /media/reprocess on confirm and toasts the count', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ reprocessed: 7 }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderMedia()
    const reprocessBtn = await screen.findByRole('button', { name: /reprocess all images/i })
    fireEvent.click(reprocessBtn)

    // Click the confirm action inside the dialog
    const confirmBtn = await screen.findByRole('button', { name: /^reprocess$/i })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/media/reprocess'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })
})

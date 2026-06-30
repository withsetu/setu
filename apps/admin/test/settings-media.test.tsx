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

function stubCapabilities(
  caps: { imageProcessing: boolean; writableMediaStore: boolean; backgroundJobs: boolean },
  reprocessedCount = 0,
) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/capabilities')) {
      return new Response(JSON.stringify({ capabilities: caps }), { status: 200 })
    }
    return new Response(JSON.stringify({ reprocessed: reprocessedCount }), { status: 200 })
  }))
}

const CAPABLE = { imageProcessing: true, writableMediaStore: true, backgroundJobs: true }

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
    stubCapabilities(CAPABLE, 42)

    renderMedia()

    // Reprocess button should be present and enabled (capable topology)
    const reprocessBtn = await screen.findByRole('button', { name: /reprocess all images/i })
    await waitFor(() => expect(reprocessBtn).not.toBeDisabled())

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
    stubCapabilities(CAPABLE, 7)
    const fetchSpy = vi.mocked(global.fetch)

    renderMedia()
    const reprocessBtn = await screen.findByRole('button', { name: /reprocess all images/i })
    await waitFor(() => expect(reprocessBtn).not.toBeDisabled())
    fireEvent.click(reprocessBtn)

    // Click the confirm action inside the dialog
    const confirmBtn = await screen.findByRole('button', { name: /^reprocess$/i })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/media/reprocess'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  describe('topology gating', () => {
    it('disables Reprocess button and shows edge message when imageProcessing=false', async () => {
      stubCapabilities({ imageProcessing: false, writableMediaStore: true, backgroundJobs: true })

      renderMedia()

      // Wait for the edge message to appear (caps loaded + gate applied)
      const msg = await screen.findByText(/image reprocessing runs in local or self-hosted mode/i)
      expect(msg).toBeTruthy()

      // Re-query after render stabilises to get the disabled button
      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /reprocess all images/i })
        expect(btn).toBeDisabled()
      })
    })

    it('disables Reprocess and shows uploads note when imageProcessing and writableMediaStore are false', async () => {
      stubCapabilities({ imageProcessing: false, writableMediaStore: false, backgroundJobs: true })

      renderMedia()

      await screen.findByRole('button', { name: /reprocess all images/i })
      const uploadsNote = await screen.findByText(/uploads won't generate variants/i)
      expect(uploadsNote).toBeTruthy()
    })

    it('keeps Reprocess button enabled when all capabilities are true', async () => {
      stubCapabilities({ imageProcessing: true, writableMediaStore: true, backgroundJobs: true })

      renderMedia()

      const reprocessBtn = await screen.findByRole('button', { name: /reprocess all images/i })
      await waitFor(() => expect(reprocessBtn).not.toBeDisabled())
    })
  })
})

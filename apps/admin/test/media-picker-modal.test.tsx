import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMediaIndexService } from '@setu/core'
import { createMemoryMediaIndexPort } from '@setu/db-memory'
import { MediaIndexProvider } from '../src/data/media-index-store'
import { NotificationProvider } from '../src/ui/notify'
import { MediaPickerModal } from '../src/editor/MediaPickerModal'
import type { MediaRecord } from '@setu/core'

// An upload that always rejects, so we can assert the modal SURFACES the failure
// (rather than swallowing it to console.error — the #756 regression).
vi.mock('../src/media/upload-client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/media/upload-client')>()
  return {
    ...actual,
    uploadFile: vi.fn(async () => {
      throw new Error('File type not allowed')
    })
  }
})

const rec: MediaRecord = {
  mediaKey: '2026/06/cat',
  key: '2026/06/cat.png',
  thumbKey: '2026/06/cat-400w.webp',
  filename: 'cat.png',
  contentType: 'image/png',
  isImage: true,
  width: 8,
  height: 6,
  bytes: 1,
  uploadedAt: 1
}

describe('MediaPickerModal', () => {
  it('picks an existing library image and returns its /media src', async () => {
    const svc = createMediaIndexService({
      mediaIndex: createMemoryMediaIndexPort(),
      fetchRaw: async () => [rec]
    })
    await svc.ensureBuilt()
    const onPick = vi.fn()
    render(
      <NotificationProvider>
        <MediaIndexProvider service={svc}>
          <MediaPickerModal
            apiBase="http://x"
            open
            onClose={() => {}}
            onPick={onPick}
          />
        </MediaIndexProvider>
      </NotificationProvider>
    )
    await waitFor(() => expect(screen.getByText('cat.png')).toBeInTheDocument())
    // Same browse experience as /media: a search box + dropzone live alongside the grid.
    expect(screen.getByLabelText('Search media')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    expect(onPick).toHaveBeenCalledWith('/media/2026/06/cat.png')
  })

  it('surfaces an upload failure as an error notification, not just console (#756)', async () => {
    const svc = createMediaIndexService({
      mediaIndex: createMemoryMediaIndexPort(),
      fetchRaw: async () => []
    })
    await svc.ensureBuilt()
    render(
      <NotificationProvider>
        <MediaIndexProvider service={svc}>
          <MediaPickerModal
            apiBase="http://x"
            open
            onClose={() => {}}
            onPick={() => {}}
          />
        </MediaIndexProvider>
      </NotificationProvider>
    )
    const input = screen.getByTestId('media-dropzone-input')
    const file = new File([new Uint8Array([1])], 'bad.gif', {
      type: 'image/gif'
    })
    fireEvent.change(input, { target: { files: [file] } })
    // The failure must reach the author via a visible error toast (role="alert"),
    // matching the standalone /media screen — not vanish into the console.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('File type not allowed')
  })
})

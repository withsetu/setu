import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMediaIndexService } from '@setu/core'
import { createMemoryMediaIndexPort } from '@setu/db-memory'
import { MediaIndexProvider } from '../src/data/media-index-store'
import { MediaPickerModal } from '../src/editor/MediaPickerModal'
import type { MediaRecord } from '@setu/core'

const rec: MediaRecord = { mediaKey: '2026/06/cat', key: '2026/06/cat.png', thumbKey: '2026/06/cat-400w.webp', filename: 'cat.png', contentType: 'image/png', isImage: true, width: 8, height: 6, bytes: 1, uploadedAt: 1 }

describe('MediaPickerModal', () => {
  it('picks an existing library image and returns its /media src', async () => {
    const svc = createMediaIndexService({ mediaIndex: createMemoryMediaIndexPort(), fetchRaw: async () => [rec] })
    await svc.ensureBuilt()
    const onPick = vi.fn()
    render(<MediaIndexProvider service={svc}><MediaPickerModal apiBase="http://x" open onClose={() => {}} onPick={onPick} /></MediaIndexProvider>)
    await waitFor(() => expect(screen.getByText('cat.png')).toBeInTheDocument())
    // Same browse experience as /media: a search box + dropzone live alongside the grid.
    expect(screen.getByLabelText('Search media')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    expect(onPick).toHaveBeenCalledWith('/media/2026/06/cat.png')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMediaIndexService } from '@setu/core'
import { createMemoryMediaIndexPort } from '@setu/db-memory'
import { MediaIndexProvider } from '../src/data/media-index-store'
import { MediaGrid } from '../src/media/MediaGrid'
import type { MediaRecord } from '@setu/core'

const rec = (mediaKey: string, filename: string): MediaRecord => ({
  mediaKey, key: `${mediaKey}.png`, thumbKey: `${mediaKey}-400w.webp`, filename,
  contentType: 'image/png', isImage: true, width: 800, height: 600, bytes: 1234, uploadedAt: 1,
})

async function svcWith(recs: MediaRecord[]) {
  const svc = createMediaIndexService({ mediaIndex: createMemoryMediaIndexPort(), fetchRaw: async () => recs })
  await svc.ensureBuilt()
  return svc
}

describe('MediaGrid', () => {
  it('renders a tile per item and calls onPick with the original src', async () => {
    const svc = await svcWith([rec('2026/06/cat', 'cat.png')])
    const onPick = vi.fn()
    render(
      <MediaIndexProvider service={svc}>
        <MediaGrid mode="pick" apiBase="http://x" onPick={onPick} query={{ offset: 0, limit: 24 }} />
      </MediaIndexProvider>,
    )
    await waitFor(() => expect(screen.getByText('cat.png')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ src: '/media/2026/06/cat.png' }))
  })
})

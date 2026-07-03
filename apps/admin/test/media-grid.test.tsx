import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMediaIndexService } from '@setu/core'
import { createMemoryMediaIndexPort } from '@setu/db-memory'
import { MediaIndexProvider } from '../src/data/media-index-store'
import { MediaGrid, MEDIA_PAGE_SIZE } from '../src/media/MediaGrid'
import type { MediaRecord } from '@setu/core'

const rec = (mediaKey: string, filename: string): MediaRecord => ({
  mediaKey,
  key: `${mediaKey}.png`,
  thumbKey: `${mediaKey}-400w.webp`,
  filename,
  contentType: 'image/png',
  isImage: true,
  width: 800,
  height: 600,
  bytes: 1234,
  uploadedAt: 1
})

async function svcWith(recs: MediaRecord[]) {
  const svc = createMediaIndexService({
    mediaIndex: createMemoryMediaIndexPort(),
    fetchRaw: async () => recs
  })
  await svc.ensureBuilt()
  return svc
}

describe('MediaGrid', () => {
  it('renders a tile per item and calls onPick with the original src', async () => {
    const svc = await svcWith([rec('2026/06/cat', 'cat.png')])
    const onPick = vi.fn()
    render(
      <MediaIndexProvider service={svc}>
        <MediaGrid
          mode="pick"
          apiBase="http://x"
          onPick={onPick}
          query={{ offset: 0, limit: 24 }}
        />
      </MediaIndexProvider>
    )
    await waitFor(() => expect(screen.getByText('cat.png')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ src: '/media/2026/06/cat.png' })
    )
  })

  it('shows one page, then appends the rest on Load more', async () => {
    const recs = Array.from({ length: MEDIA_PAGE_SIZE + 6 }, (_, i) =>
      rec(
        `2026/06/img${String(i).padStart(2, '0')}`,
        `img${String(i).padStart(2, '0')}.png`
      )
    )
    const svc = await svcWith(recs)
    render(
      <MediaIndexProvider service={svc}>
        <MediaGrid
          mode="manage"
          apiBase="http://x"
          query={{ offset: 0, limit: MEDIA_PAGE_SIZE }}
          onSelect={() => {}}
        />
      </MediaIndexProvider>
    )
    const tiles = () => screen.getAllByRole('button', { name: /img\d+\.png/i })
    await waitFor(() => expect(tiles()).toHaveLength(MEDIA_PAGE_SIZE)) // first page only
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    await waitFor(() => expect(tiles()).toHaveLength(MEDIA_PAGE_SIZE + 6)) // remainder appended
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull() // nothing left
  })
})

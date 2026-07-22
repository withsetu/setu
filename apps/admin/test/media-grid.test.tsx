import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMediaIndexService } from '@setu/core'
import { createMemoryMediaIndexPort } from '@setu/db-memory'
import { MediaIndexProvider } from '../src/data/media-index-store'
import { NotificationProvider } from '../src/ui/notify'
import { MediaGrid, MEDIA_PAGE_SIZE } from '../src/media/MediaGrid'
import type { MediaIndexService, MediaRecord } from '@setu/core'

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

/** A service whose reads reject until `heal()` is called — the shape a wedged
 *  IndexedDB store or an unreachable server produces (#833). `ensureBuilt` and
 *  `refresh` resolve so the failure lands on `query`, the one call every code
 *  path goes through. */
function brokenSvc(rows: MediaRecord[]) {
  let healthy = false
  const inner = createMediaIndexService({
    mediaIndex: createMemoryMediaIndexPort(),
    fetchRaw: async () => rows
  })
  const svc: MediaIndexService = {
    ensureBuilt: () => (healthy ? inner.ensureBuilt() : Promise.resolve()),
    refresh: () => Promise.resolve(),
    rebuild: () => Promise.resolve(),
    query: (q) =>
      healthy
        ? inner.query(q)
        : Promise.reject(new Error('media index unavailable')),
    upsertOne: (r) => inner.upsertOne(r),
    removeOne: (k) => inner.removeOne(k)
  }
  return {
    svc,
    heal: () => {
      healthy = true
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MediaGrid', () => {
  it('renders a tile per item and calls onPick with the original src', async () => {
    const svc = await svcWith([rec('2026/06/cat', 'cat.png')])
    const onPick = vi.fn()
    render(
      <NotificationProvider>
        <MediaIndexProvider service={svc}>
          <MediaGrid
            mode="pick"
            apiBase="http://x"
            onPick={onPick}
            query={{ offset: 0, limit: 24 }}
          />
        </MediaIndexProvider>
      </NotificationProvider>
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
      <NotificationProvider>
        <MediaIndexProvider service={svc}>
          <MediaGrid
            mode="manage"
            apiBase="http://x"
            query={{ offset: 0, limit: MEDIA_PAGE_SIZE }}
            onSelect={() => {}}
          />
        </MediaIndexProvider>
      </NotificationProvider>
    )
    const tiles = () => screen.getAllByRole('button', { name: /img\d+\.png/i })
    await waitFor(() => expect(tiles()).toHaveLength(MEDIA_PAGE_SIZE)) // first page only
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    await waitFor(() => expect(tiles()).toHaveLength(MEDIA_PAGE_SIZE + 6)) // remainder appended
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull() // nothing left
  })

  // #833: a rejecting first-page load used to leave the skeleton up forever —
  // indistinguishable from a slow network and from an empty library.
  it('replaces the skeleton with a visible error when the first page fails, and retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { svc, heal } = brokenSvc([rec('2026/06/cat', 'cat.png')])
    render(
      <NotificationProvider>
        <MediaIndexProvider service={svc}>
          <MediaGrid
            mode="manage"
            apiBase="http://x"
            query={{ offset: 0, limit: MEDIA_PAGE_SIZE }}
            onSelect={() => {}}
          />
        </MediaIndexProvider>
      </NotificationProvider>
    )

    // The failure is reported in place …
    const retry = await screen.findByRole('button', { name: /try again/i })
    // … the loading skeleton is gone (not "still loading forever") …
    expect(screen.queryByLabelText('Loading media')).toBeNull()
    // … it is NOT the empty state ("No media yet" would be a lie) …
    expect(screen.queryByText(/no media yet/i)).toBeNull()
    // … and it is announced, so it is not merely a grey paragraph.
    expect(
      screen.getAllByText(/couldn't load the media library/i).length
    ).toBeGreaterThan(0)

    heal()
    fireEvent.click(retry)
    await waitFor(() => expect(screen.getByText('cat.png')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  it('reports a failed Load more instead of silently doing nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const recs = Array.from({ length: MEDIA_PAGE_SIZE + 6 }, (_, i) =>
      rec(
        `2026/06/img${String(i).padStart(2, '0')}`,
        `img${String(i).padStart(2, '0')}.png`
      )
    )
    const svc = await svcWith(recs)
    const realQuery = svc.query.bind(svc)
    let failNext = false
    svc.query = (q) =>
      failNext
        ? Promise.reject(new Error('media index unavailable'))
        : realQuery(q)

    render(
      <NotificationProvider>
        <MediaIndexProvider service={svc}>
          <MediaGrid
            mode="manage"
            apiBase="http://x"
            query={{ offset: 0, limit: MEDIA_PAGE_SIZE }}
            onSelect={() => {}}
          />
        </MediaIndexProvider>
      </NotificationProvider>
    )
    const tiles = () => screen.getAllByRole('button', { name: /img\d+\.png/i })
    await waitFor(() => expect(tiles()).toHaveLength(MEDIA_PAGE_SIZE))

    failNext = true
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    await screen.findByText(/couldn't load more media/i)
    // The page that was already there stays, and the button is usable again.
    expect(tiles()).toHaveLength(MEDIA_PAGE_SIZE)
    expect(
      screen.getByRole('button', { name: /load more/i })
    ).not.toBeDisabled()
  })
})

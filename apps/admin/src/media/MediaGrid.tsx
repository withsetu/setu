import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaIndexQuery, MediaIndexRow } from '@setu/core'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useMediaIndex } from '../data/media-index-store'
import { useNotify } from '../ui/notify'
import { resolveMediaSrc } from '../editor/media-src'

/** Items per page; the grid owns paging (Load more), ignoring any offset/limit
 *  on the incoming query so both /media and the picker paginate identically. */
export const MEDIA_PAGE_SIZE = 24

/** Shown both in place of the grid and as the toast, so the failure is visible
 *  whether the reader is looking at the grid or elsewhere on the screen. */
const LOAD_FAILED_MESSAGE =
  "Couldn't load the media library. Check your connection and try again."

export interface PickPayload {
  src: string
  row: MediaIndexRow
}

export interface MediaGridProps {
  mode: 'manage' | 'pick'
  apiBase: string
  query: MediaIndexQuery
  onPick?: (payload: PickPayload) => void
  onSelect?: (row: MediaIndexRow) => void
  onQueryChange?: (q: Partial<MediaIndexQuery>) => void
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileIcon() {
  return (
    <svg
      className="size-10 text-muted-foreground opacity-60"
      viewBox="0 0 24 24"
      width="40"
      height="40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.172 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8.828a2 2 0 00-.586-1.414l-3.828-3.828A2 2 0 0015.172 2z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 2v5a1 1 0 001 1h5"
      />
    </svg>
  )
}

export function MediaGrid({
  mode,
  apiBase,
  query,
  onPick,
  onSelect
}: MediaGridProps) {
  const index = useMediaIndex()
  const notify = useNotify()
  const [rows, setRows] = useState<MediaIndexRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const refreshedRef = useRef(false)

  // Query one page (PAGE_SIZE rows from `offset`), overriding any offset/limit the
  // caller put on `query` so the grid is the single source of paging.
  const pageAt = useCallback(
    (offset: number) =>
      index.query({ ...query, offset, limit: MEDIA_PAGE_SIZE }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, query.q, query.type, query.sort?.key, query.sort?.dir]
  )

  // (Re)load the first page whenever the filter changes. SWR: query the cache, then
  // refresh from the feed once on mount and re-query.
  //
  // #833: every await here is inside the try. `rows` is only ever set on the
  // success path, so an escaping rejection used to leave the grid on its loading
  // skeleton forever — a broken library looked exactly like a slow one.
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        await index.ensureBuilt()
        const r = await pageAt(0)
        if (!live) return
        setRows(r.rows)
        setTotal(r.total)
        setLoadFailed(false)
        if (!refreshedRef.current) {
          refreshedRef.current = true
          await index.refresh()
          const r2 = await pageAt(0)
          if (!live) return
          setRows(r2.rows)
          setTotal(r2.total)
        }
      } catch (err) {
        if (!live) return
        console.error('[media] loading the media library failed', err)
        setLoadFailed(true)
        notify.error(LOAD_FAILED_MESSAGE)
      }
    })()
    return () => {
      live = false
    }
  }, [index, pageAt, notify, retryKey])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const r = await pageAt(rows?.length ?? 0)
      setRows((prev) => [...(prev ?? []), ...r.rows])
      setTotal(r.total)
    } catch (err) {
      // Keeps the rows already on screen: only the extra page is missing, and
      // the button re-enables so the reader can just try again.
      console.error('[media] loading another page of media failed', err)
      notify.error(
        "Couldn't load more media. Check your connection and try again."
      )
    } finally {
      setLoadingMore(false)
    }
  }

  const handleTileClick = (row: MediaIndexRow) => {
    if (mode === 'pick') {
      onPick?.({ src: '/media/' + row.key, row })
    } else {
      onSelect?.(row)
    }
  }

  // A failed FIRST load has no rows to show, so the failure takes the grid's
  // place: an honest, retryable state the reader can tell apart from "empty".
  // A later failure (the SWR refresh, or Load more) keeps the rows it already
  // has and reports through the toast alone.
  if (rows === null && loadFailed) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 px-5 py-12 text-center"
      >
        <p className="text-sm text-muted-foreground">{LOAD_FAILED_MESSAGE}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoadFailed(false)
            setRetryKey((k) => k + 1)
          }}
        >
          Try again
        </Button>
      </div>
    )
  }

  if (rows === null) {
    return (
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3"
        aria-busy="true"
        aria-label="Loading media"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-md" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    const isEmpty = !query.q && (!query.type || query.type === 'all')
    return (
      <p className="px-5 py-12 text-center text-sm text-muted-foreground">
        {isEmpty ? 'No media yet' : 'No matches'}
      </p>
    )
  }

  return (
    <>
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3"
        data-total={total}
      >
        {rows.map((row) => {
          const thumbSrc = row.isImage
            ? resolveMediaSrc('/media/' + (row.thumbKey ?? row.key), apiBase)
            : null

          return (
            <button
              key={row.mediaKey}
              type="button"
              aria-label={row.filename}
              onClick={() => handleTileClick(row)}
              className="group flex flex-col overflow-hidden rounded-md border border-border bg-card text-left shadow-sm transition-[border-color,box-shadow] hover:border-ring hover:ring-2 hover:ring-ring/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
                {thumbSrc ? (
                  <img
                    src={thumbSrc}
                    alt={row.filename}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <FileIcon />
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
                <span className="truncate text-xs font-medium">
                  {row.filename}
                </span>
                {row.isImage && row.width != null && row.height != null && (
                  <span className="text-[11px] text-muted-foreground">
                    {row.width}×{row.height}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {humanSize(row.bytes)}
                </span>
              </div>
            </button>
          )
        })}
      </div>
      {rows.length < total && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore
              ? 'Loading…'
              : `Load more (${total - rows.length} more)`}
          </Button>
        </div>
      )}
    </>
  )
}

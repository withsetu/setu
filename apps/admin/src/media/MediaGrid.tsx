import { useEffect, useRef, useState } from 'react'
import type { MediaIndexQuery, MediaIndexRow } from '@setu/core'
import { useMediaIndex } from '../data/media-index-store'
import { resolveMediaSrc } from '../editor/media-src'

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
      className="media-tile-file-icon"
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
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 2v5a1 1 0 001 1h5" />
    </svg>
  )
}

export function MediaGrid({ mode, apiBase, query, onPick, onSelect }: MediaGridProps) {
  const index = useMediaIndex()
  const [rows, setRows] = useState<MediaIndexRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const refreshedRef = useRef(false)

  useEffect(() => {
    let live = true

    void (async () => {
      await index.ensureBuilt()
      const r = await index.query(query)
      if (live) {
        setRows(r.rows)
        setTotal(r.total)
      }

      // Stale-while-revalidate: refresh once on mount then re-query
      if (!refreshedRef.current) {
        refreshedRef.current = true
        await index.refresh()
        const r2 = await index.query(query)
        if (live) {
          setRows(r2.rows)
          setTotal(r2.total)
        }
      }
    })()

    return () => {
      live = false
    }
    // query object changes drive re-queries; stringify to compare by value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, query.q, query.type, query.offset, query.limit, query.sort?.key, query.sort?.dir])

  const handleTileClick = (row: MediaIndexRow) => {
    if (mode === 'pick') {
      onPick?.({ src: '/media/' + row.key, row })
    } else {
      onSelect?.(row)
    }
  }

  if (rows === null) {
    return (
      <div className="media-grid-loading" aria-busy="true" aria-label="Loading media">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="media-tile media-tile-skeleton" aria-hidden="true" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <p className="media-grid-empty empty-state">
        No matches
      </p>
    )
  }

  return (
    <div
      className="media-grid"
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
            className="media-tile"
            aria-label={row.filename}
            onClick={() => handleTileClick(row)}
          >
            <div className="media-tile-thumb">
              {thumbSrc ? (
                <img
                  src={thumbSrc}
                  alt={row.filename}
                  loading="lazy"
                  className="media-tile-img"
                />
              ) : (
                <FileIcon />
              )}
            </div>
            <div className="media-tile-info">
              <span className="media-tile-name">{row.filename}</span>
              {row.isImage && row.width != null && row.height != null && (
                <span className="media-tile-dims">{row.width}×{row.height}</span>
              )}
              <span className="media-tile-size">{humanSize(row.bytes)}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

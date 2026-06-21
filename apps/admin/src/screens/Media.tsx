import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { MediaIndexQuery, MediaIndexRow, MediaSortKey } from '@setu/core'
import { PageHeader } from '../shell/PageHeader'
import { MediaGrid } from '../media/MediaGrid'
import { MediaDropzone } from '../media/MediaDropzone'
import { useMediaIndex } from '../data/media-index-store'
import { useServices } from '../data/store'
import { deleteMedia } from '../media/media-client'
import { resolveMediaSrc } from '../editor/media-src'
import { useNotify } from '../ui/notify'

const apiBase = (import.meta.env.VITE_SETU_API as string | undefined) ?? ''

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type SortOption = { label: string; key: MediaSortKey; dir: 'asc' | 'desc' }

const SORT_OPTIONS: SortOption[] = [
  { label: 'Newest', key: 'uploadedAt', dir: 'desc' },
  { label: 'Name', key: 'filename', dir: 'asc' },
  { label: 'Largest', key: 'bytes', dir: 'desc' },
]

function parseSort(raw: string | null): { key: MediaSortKey; dir: 'asc' | 'desc' } {
  if (raw) {
    const [key, dir] = raw.split('-')
    const opt = SORT_OPTIONS.find((o) => o.key === key && o.dir === dir)
    if (opt) return { key: opt.key, dir: opt.dir }
  }
  return { key: 'uploadedAt', dir: 'desc' }
}

export function Media() {
  const mediaIndex = useMediaIndex()
  const { index } = useServices()
  const [params, setParams] = useSearchParams()
  const notify = useNotify()
  const [selected, setSelected] = useState<MediaIndexRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const q = params.get('q') ?? ''
  const type = (params.get('type') ?? 'all') as 'image' | 'all'
  const sortRaw = params.get('sort')
  const sort = parseSort(sortRaw)

  const setParam = (key: string, value: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  // Debounced search: local state → URL `q`
  const [search, setSearch] = useState(q)
  useEffect(() => {
    setSearch(q)
  }, [q])
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== q) setParam('q', search)
    }, 200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const query = useMemo<MediaIndexQuery>(
    () => ({ q: q || undefined, type, sort, offset: 0, limit: 100 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, type, sort.key, sort.dir],
  )

  const sortValue = `${sort.key}-${sort.dir}`

  function onUploaded(result: { record: import('@setu/core').MediaRecord }) {
    void mediaIndex.upsertOne(result.record)
    setRefreshKey((k) => k + 1)
    notify.success('Uploaded ' + result.record.filename)
  }

  async function onDelete() {
    if (!selected) return
    setDeleting(true)
    try {
      const used = await index.referencedBy(selected.mediaKey)
      const confirmed =
        used.length > 0
          ? window.confirm(
              `Used in ${used.length} post(s): ${used.map((u) => u.title).join(', ')}. Delete anyway?`,
            )
          : window.confirm(`Delete ${selected.filename}?`)
      if (!confirmed) {
        setDeleting(false)
        return
      }
      await deleteMedia(apiBase, selected.mediaKey)
      await mediaIndex.removeOne(selected.mediaKey)
      const deletedFilename = selected.filename
      setSelected(null)
      setRefreshKey((k) => k + 1)
      notify.success('Deleted ' + deletedFilename)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }

  function onCopyUrl() {
    const url = resolveMediaSrc('/media/' + selected!.key, apiBase)
    navigator.clipboard?.writeText(url)
  }

  return (
    <section className="media-screen">
      <PageHeader
        title="Media"
        subtitle="Upload, browse, and manage your media files."
      />
      <div className="page-body">
        {/* Toolbar */}
        <div className="list-toolbar">
          <input
            type="search"
            className="list-search"
            placeholder="Search media"
            aria-label="Search media"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="Sort"
            value={sortValue}
            onChange={(e) => setParam('sort', e.target.value)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={`${o.key}-${o.dir}`} value={`${o.key}-${o.dir}`}>{o.label}</option>
            ))}
          </select>
          <select
            aria-label="Filter by type"
            value={type}
            onChange={(e) => setParam('type', e.target.value)}
          >
            <option value="all">All types</option>
            <option value="image">Images</option>
          </select>
        </div>

        {/* Upload dropzone */}
        <MediaDropzone
          apiBase={apiBase}
          onUploaded={onUploaded}
          onError={(m) => notify.error(m)}
        />

        {/* Grid — key={refreshKey} remounts on upload/delete so it re-queries fresh data */}
        <MediaGrid
          key={refreshKey}
          mode="manage"
          apiBase={apiBase}
          query={query}
          onSelect={(row) => setSelected(row)}
        />

        {/* Detail panel */}
        {selected && (
          <aside className="media-detail" role="complementary" aria-label="Media details">
            <div className="media-detail-header">
              <h2 className="media-detail-title">{selected.filename}</h2>
              <button
                type="button"
                className="media-detail-close btn btn-sm"
                aria-label="Close detail panel"
                onClick={() => setSelected(null)}
              >
                ✕
              </button>
            </div>
            <div className="media-detail-body">
              {selected.isImage && selected.width != null && selected.height != null && (
                <p className="media-detail-meta">{selected.width} × {selected.height}px</p>
              )}
              <p className="media-detail-meta">{humanSize(selected.bytes)}</p>
              <p className="media-detail-meta muted">{selected.contentType}</p>
            </div>
            <div className="media-detail-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={onCopyUrl}
              >
                Copy URL
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={deleting}
                onClick={() => { void onDelete() }}
                aria-label={`Delete ${selected.filename}`}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </aside>
        )}
      </div>
    </section>
  )
}

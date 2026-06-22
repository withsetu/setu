import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { MediaIndexRow } from '@setu/core'
import { PageHeader } from '../shell/PageHeader'
import { PageBody } from '../shell/PageBody'
import { MediaBrowser, parseSortValue, sortValueOf } from '../media/MediaBrowser'
import type { MediaFilters } from '../media/MediaBrowser'
import { useMediaIndex } from '../data/media-index-store'
import { useServices } from '../data/store'
import { deleteMedia } from '../media/media-client'
import { resolveMediaSrc } from '../editor/media-src'
import type { UploadResult } from '../media/upload-client'
import { useNotify } from '../ui/notify'

const apiBase = (import.meta.env.VITE_SETU_API as string | undefined) ?? ''

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function Media() {
  const mediaIndex = useMediaIndex()
  const { index } = useServices()
  const notify = useNotify()
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<MediaIndexRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // Filter state lives in the URL so a filtered media view is shareable + survives reload.
  const filters: MediaFilters = {
    q: params.get('q') ?? '',
    type: (params.get('type') ?? 'all') as MediaFilters['type'],
    sort: parseSortValue(params.get('sort')),
  }
  const setFilters = (patch: Partial<MediaFilters>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if ('q' in patch) { patch.q ? next.set('q', patch.q) : next.delete('q') }
        if ('type' in patch) { patch.type && patch.type !== 'all' ? next.set('type', patch.type) : next.delete('type') }
        if ('sort' in patch && patch.sort) {
          const v = sortValueOf(patch.sort)
          v === 'uploadedAt-desc' ? next.delete('sort') : next.set('sort', v)
        }
        return next
      },
      { replace: true },
    )
  }

  function onUploaded(result: UploadResult) {
    void mediaIndex.upsertOne(result.record)
    setRefreshKey((k) => k + 1)
    notify.success('Uploaded ' + result.record.filename)
  }

  async function onDelete() {
    if (!selected) return
    setDeleting(true)
    const deletedFilename = selected.filename
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
      <PageBody>
        <MediaBrowser
          apiBase={apiBase}
          mode="manage"
          filters={filters}
          setFilters={setFilters}
          onUploaded={onUploaded}
          onError={(m) => notify.error(m)}
          onSelect={(row) => setSelected(row)}
          refreshKey={refreshKey}
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
      </PageBody>
    </section>
  )
}

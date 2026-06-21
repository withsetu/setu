import { useState } from 'react'
import { MediaBrowser, DEFAULT_SORT } from '../media/MediaBrowser'
import type { MediaFilters } from '../media/MediaBrowser'
import { srcFromUploadUrl } from './image-insert'

export interface MediaPickerModalProps {
  apiBase: string
  open: boolean
  onClose: () => void
  onPick: (src: string) => void
}

/** Pick-or-upload library modal: the same browse experience as the /media screen
 *  (drag-drop upload on top, search/sort/filter, grid) in pick mode. Choosing or
 *  uploading an image picks it and closes. */
export function MediaPickerModal({ apiBase, open, onClose, onPick }: MediaPickerModalProps) {
  const [filters, setFilters] = useState<MediaFilters>({ q: '', type: 'all', sort: DEFAULT_SORT })

  if (!open) return null

  const pick = (src: string) => {
    onPick(src)
    onClose()
  }

  return (
    <div
      className="media-picker-overlay"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pick or upload image"
        className="media-picker-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="media-picker-header">
          <h2 className="media-picker-title">Add an image</h2>
          <button type="button" className="media-picker-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="media-picker-body">
          <MediaBrowser
            apiBase={apiBase}
            mode="pick"
            filters={filters}
            setFilters={(patch) => setFilters((f) => ({ ...f, ...patch }))}
            onUploaded={(r) => pick(srcFromUploadUrl(r.url))}
            onError={(msg) => console.error('upload error:', msg)}
            onPick={pick}
          />
        </div>
      </div>
    </div>
  )
}

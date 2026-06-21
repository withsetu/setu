import { useState } from 'react'
import { MediaGrid } from '../media/MediaGrid'
import { MediaDropzone } from '../media/MediaDropzone'
import { srcFromUploadUrl } from './image-insert'

export interface MediaPickerModalProps {
  apiBase: string
  open: boolean
  onClose: () => void
  onPick: (src: string) => void
}

type Tab = 'library' | 'upload'

export function MediaPickerModal({ apiBase, open, onClose, onPick }: MediaPickerModalProps) {
  const [tab, setTab] = useState<Tab>('library')

  if (!open) return null

  const handlePick = (src: string) => {
    onPick(src)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      className="media-picker-overlay"
      role="presentation"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pick or upload image"
        className="media-picker-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="media-picker-header">
          <div className="media-picker-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'library'}
              onClick={() => setTab('library')}
              type="button"
            >
              Library
            </button>
            <button
              role="tab"
              aria-selected={tab === 'upload'}
              onClick={() => setTab('upload')}
              type="button"
            >
              Upload
            </button>
          </div>
          <button
            type="button"
            className="media-picker-close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="media-picker-body">
          {tab === 'library' && (
            <MediaGrid
              mode="pick"
              apiBase={apiBase}
              query={{ offset: 0, limit: 100 }}
              onPick={({ src }) => handlePick(src)}
            />
          )}
          {tab === 'upload' && (
            <MediaDropzone
              apiBase={apiBase}
              accept={{ 'image/*': [] }}
              onUploaded={(r) => handlePick(srcFromUploadUrl(r.url))}
              onError={(msg) => console.error('upload error:', msg)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

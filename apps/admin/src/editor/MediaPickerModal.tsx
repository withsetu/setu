import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { MediaBrowser, DEFAULT_SORT } from '../media/MediaBrowser'
import type { MediaFilters } from '../media/MediaBrowser'
import { srcFromUploadUrl } from './image-insert'

export interface MediaPickerModalProps {
  apiBase: string
  open: boolean
  onClose: () => void
  onPick: (src: string) => void
  /** Which media kind is being picked — filters the library, constrains uploads,
   *  and titles the dialog. Defaults to image (the historical behavior). */
  kind?: 'image' | 'video'
}

export function MediaPickerModal({
  apiBase,
  open,
  onClose,
  onPick,
  kind = 'image'
}: MediaPickerModalProps) {
  const [filters, setFilters] = useState<MediaFilters>({
    q: '',
    type: 'all',
    sort: DEFAULT_SORT
  })
  const pick = (src: string) => {
    onPick(src)
    onClose()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-[880px]">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle>
            {kind === 'video' ? 'Add a video' : 'Add an image'}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto p-5">
          <MediaBrowser
            apiBase={apiBase}
            mode="pick"
            pickKind={kind}
            filters={filters}
            setFilters={(patch) => setFilters((f) => ({ ...f, ...patch }))}
            onUploaded={(r) => pick(srcFromUploadUrl(r.url))}
            onError={(msg) => console.error('upload error:', msg)}
            onPick={pick}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { MediaIndexRow, MediaUsage } from '@setu/core'
import { PageHeader } from '../shell/PageHeader'
import { PageBody } from '../shell/PageBody'
import {
  MediaBrowser,
  parseSortValue,
  sortValueOf
} from '../media/MediaBrowser'
import type { MediaFilters } from '../media/MediaBrowser'
import { useMediaIndex } from '../data/media-index-store'
import { useIndex } from '../data/index-store'
import { deleteMedia } from '../media/media-client'
import { resolveMediaSrc } from '../editor/media-src'
import type { UploadResult } from '../media/upload-client'
import { useNotify } from '../ui/notify'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

const apiBase = import.meta.env.VITE_SETU_API ?? ''

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function Media() {
  const mediaIndex = useMediaIndex()
  // Through the IndexService (not the raw IndexPort): in the server-backed
  // topology the port is only a partial cache — usage truth lives behind
  // /api/index/referenced-by, plus this browser's draft overlay (#464).
  const index = useIndex()
  const notify = useNotify()
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<MediaIndexRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [usedBy, setUsedBy] = useState<MediaUsage[]>([])

  // Filter state lives in the URL so a filtered media view is shareable + survives reload.
  const filters: MediaFilters = {
    q: params.get('q') ?? '',
    type: (params.get('type') ?? 'all') as MediaFilters['type'],
    sort: parseSortValue(params.get('sort'))
  }
  const setFilters = (patch: Partial<MediaFilters>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if ('q' in patch) {
          if (patch.q) next.set('q', patch.q)
          else next.delete('q')
        }
        if ('type' in patch) {
          if (patch.type && patch.type !== 'all') next.set('type', patch.type)
          else next.delete('type')
        }
        if ('sort' in patch && patch.sort) {
          const v = sortValueOf(patch.sort)
          if (v === 'uploadedAt-desc') next.delete('sort')
          else next.set('sort', v)
        }
        return next
      },
      { replace: true }
    )
  }

  function onUploaded(result: UploadResult) {
    void mediaIndex.upsertOne(result.record)
    setRefreshKey((k) => k + 1)
    notify.success('Uploaded ' + result.record.filename)
  }

  async function requestDelete() {
    if (!selected) return
    try {
      setUsedBy(await index.referencedBy(selected.mediaKey))
    } catch {
      setUsedBy([])
    }
    setConfirmOpen(true)
  }

  async function confirmDelete() {
    if (!selected) return
    setDeleting(true)
    const deletedFilename = selected.filename
    try {
      await deleteMedia(apiBase, selected.mediaKey)
      await mediaIndex.removeOne(selected.mediaKey)
      setConfirmOpen(false)
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
    void navigator.clipboard?.writeText(url)
  }

  const usedNote =
    usedBy.length > 0
      ? `Used in ${usedBy.length} post(s): ${usedBy.map((u) => u.title).join(', ')}. This can't be undone.`
      : "This can't be undone."

  return (
    <section className="relative">
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

        <Sheet
          open={selected !== null}
          onOpenChange={(o) => {
            if (!o) setSelected(null)
          }}
        >
          <SheetContent className="w-80 gap-0 p-0" aria-label="Media details">
            <SheetHeader className="border-b p-4">
              <SheetTitle className="sr-only">Media details</SheetTitle>
              <h2 className="truncate text-sm font-semibold">
                {selected?.filename}
              </h2>
            </SheetHeader>
            {selected && (
              <>
                <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-4">
                  {selected.isImage &&
                    selected.width != null &&
                    selected.height != null && (
                      <p className="text-xs text-foreground/80">
                        {selected.width} × {selected.height}px
                      </p>
                    )}
                  <p className="text-xs text-foreground/80">
                    {humanSize(selected.bytes)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {selected.contentType}
                  </p>
                </div>
                <div className="flex gap-2 border-t p-4">
                  <Button variant="outline" size="sm" onClick={onCopyUrl}>
                    Copy URL
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={deleting}
                    aria-label={`Delete ${selected.filename}`}
                    onClick={() => void requestDelete()}
                  >
                    Delete
                  </Button>
                </div>
              </>
            )}
          </SheetContent>
        </Sheet>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {selected?.filename}?</AlertDialogTitle>
              <AlertDialogDescription>{usedNote}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void confirmDelete()}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageBody>
    </section>
  )
}

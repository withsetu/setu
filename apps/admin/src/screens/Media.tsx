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
import { deleteMedia, MediaTransportError } from '../media/media-client'
import { resolveMediaSrc } from '../editor/media-src'
import type { UploadResult } from '../media/upload-client'
import { useNotify } from '../ui/notify'
import { connectionError } from '../ui/error-message'
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

  /** #804: the index write is the only part that can fail here — the file and its
   *  record are already stored server-side by the time this runs, and in the
   *  server-backed topology `upsertOne` is cache upkeep only (see
   *  data/http-media-index-service.ts), so the refreshKey re-query below is a real
   *  recovery. The success toast therefore stands regardless; a rejection adds a
   *  second, narrower message instead of being discarded, which is how a failed
   *  index write used to be indistinguishable from a clean upload.
   *  Enforced by test/media-screen.test.tsx. */
  function onUploaded(result: UploadResult) {
    const filename = result.record.filename
    void mediaIndex.upsertOne(result.record).catch((err: unknown) => {
      console.error('[media] index update after upload failed', err)
      notify.error(
        `Uploaded ${filename}, but the media list couldn't be updated — reload the page if it's missing.`
      )
    })
    setRefreshKey((k) => k + 1)
    notify.success('Uploaded ' + filename)
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
      console.error('[media] deleting the file failed', err)
      // #870: a MediaTransportError never reached the server, so its message is
      // fetch's raw "Failed to fetch" — curate it. Anything else came BACK from the
      // API and carries the reason (a 409 "media is in use", a 404), which beats a
      // generic line; curating it too would be the #852 inversion.
      // Both directions enforced by apps/admin/test/media-screen.test.tsx.
      notify.error(
        err instanceof MediaTransportError
          ? connectionError('delete the file')
          : err instanceof Error
            ? err.message
            : String(err)
      )
    } finally {
      setDeleting(false)
    }
  }

  async function onCopyUrl() {
    if (!selected) return
    const url = resolveMediaSrc('/media/' + selected.key, apiBase)
    try {
      // Rejects when clipboard permission is denied, and there was no success feedback
      // either way before (#837).
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(url)
      notify.success('URL copied to clipboard')
    } catch (err) {
      console.error('[media] copying the media URL failed', err)
      notify.error("Couldn't copy the URL to the clipboard.")
    }
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void onCopyUrl()}
                  >
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

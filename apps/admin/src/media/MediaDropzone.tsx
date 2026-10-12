import { useCallback } from 'react'
import type { ReactNode } from 'react'
import {
  useDropzone,
  type Accept,
  type DropEvent,
  type DropzoneInputProps,
  type FileRejection
} from 'react-dropzone'
import { cn } from '@/lib/utils'
import {
  ingestFailureNotice,
  uploadFile,
  type UploadResult
} from './upload-client'

/** Read a flat File[] straight from the drop/input event. This REPLACES
 *  react-dropzone's default `file-selector` aggregator, which calls
 *  `FileSystemFileHandle.getFile()` on dropped items and throws
 *  "NotAllowedError: getFile on FileSystemFileHandle" in several browsers/contexts
 *  — breaking drag-and-drop upload. We don't need folder traversal for media, so a
 *  plain list from `dataTransfer.files` / `input.files` is exactly right (and uses
 *  only the synchronous `getAsFile`, never the FS-handle API). A pasted file (a screenshot on
 *  Ctrl/Cmd+V) is read the same way from `clipboardData` (#1234).
 *
 *  react-dropzone hands this a FileSystemFileHandle list only when `useFsAccessApi` is on;
 *  MediaDropzone sets it false, so a handle list is a wiring error and throws (routed to
 *  `onError`) rather than resolving to an empty drop. Enforced by
 *  apps/admin/test/media-dropzone.test.tsx. */
export function filesFromEvent(
  event: DropEvent | FileSystemFileHandle[]
): File[] {
  if (Array.isArray(event))
    throw new Error(
      'MediaDropzone received file-system handles; it must run with useFsAccessApi: false'
    )
  // A paste (#1234) carries its files under clipboardData; a drop under dataTransfer.
  const dt =
    (event as DragEvent).dataTransfer ?? (event as ClipboardEvent).clipboardData
  if (dt) {
    if (dt.files && dt.files.length > 0) return Array.from(dt.files)
    if (dt.items && dt.items.length > 0) {
      return Array.from(dt.items)
        .filter((i) => i.kind === 'file')
        .map((i) => i.getAsFile())
        .filter((f): f is File => f != null)
    }
  }
  const input = (event as Event & { target: HTMLInputElement | null }).target
  if (input && input.files && input.files.length > 0)
    return Array.from(input.files)
  return []
}

export interface MediaDropzoneProps {
  apiBase: string
  onUploaded: (result: UploadResult) => void
  onError?: (msg: string) => void
  onBusy?: (busy: boolean) => void
  disabled?: boolean
  children?: ReactNode
  upload?: typeof uploadFile
  accept?: Accept
  /** What `accept` admits, in words ("images", "MP4 or WebM videos"). Used in the hint and
   *  in the message for a rejected drop. */
  acceptLabel?: string
}

/** One message for a drop's rejected files (#1233), so a mismatched drop is never silent.
 *  Enforced by apps/admin/test/media-dropzone.test.tsx. */
export function rejectionMessage(
  rejections: readonly FileRejection[],
  acceptLabel = 'files of this type'
): string | null {
  const [first, ...rest] = rejections
  if (!first) return null
  // Only a type mismatch is about what the picker accepts; anything else (a size limit, say)
  // keeps the library's own reason rather than being mislabelled.
  const other = rejections.find(
    (r) => !r.errors.every((e) => e.code === 'file-invalid-type')
  )
  if (other)
    return `${other.file.name} can't be added: ${other.errors[0]?.message ?? 'rejected'}.`
  const who =
    rest.length === 0
      ? first.file.name
      : `${first.file.name} and ${rest.length} more`
  return `${who} can't be added — this picker accepts ${acceptLabel}.`
}

export function MediaDropzone({
  apiBase,
  onUploaded,
  onError,
  onBusy,
  disabled,
  children,
  upload = uploadFile,
  accept,
  acceptLabel
}: MediaDropzoneProps) {
  const onDrop = useCallback(
    async (files: File[]) => {
      onBusy?.(true)
      try {
        for (const file of files) {
          const result = await upload(apiBase, file)
          onUploaded(result)
          // #1161: stored, but no resized versions — usable, and the user must hear about it.
          const notice = ingestFailureNotice(result)
          if (notice) onError?.(notice)
        }
      } catch (err) {
        onError?.(err instanceof Error ? err.message : String(err))
      } finally {
        onBusy?.(false)
      }
    },
    [apiBase, onUploaded, onError, onBusy, upload]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => void onDrop(files),
    accept,
    disabled,
    useFsAccessApi: false,
    getFilesFromEvent: async (event) => filesFromEvent(event),
    onError: (err) => onError?.(err.message),
    onDropRejected: (rejections) => {
      const msg = rejectionMessage(rejections, acceptLabel)
      if (msg) onError?.(msg)
    }
  })

  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex min-h-20 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-border px-5 text-sm text-muted-foreground transition-colors',
        'hover:border-primary hover:bg-accent data-[drag-active]:border-primary data-[drag-active]:bg-accent'
      )}
      data-drag-active={isDragActive ? '' : undefined}
    >
      <input
        {...getInputProps({
          'data-testid': 'media-dropzone-input'
        } as DropzoneInputProps)}
      />
      {children ?? (
        <p>Drag {acceptLabel ?? 'files'} here, paste, or click to upload</p>
      )}
    </div>
  )
}

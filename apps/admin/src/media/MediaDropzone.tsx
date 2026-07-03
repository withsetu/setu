import { useCallback } from 'react'
import type { ReactNode } from 'react'
import {
  useDropzone,
  type Accept,
  type DropEvent,
  type DropzoneInputProps
} from 'react-dropzone'
import { cn } from '@/lib/utils'
import { uploadFile, type UploadResult } from './upload-client'

/** Read a flat File[] straight from the drop/input event. This REPLACES
 *  react-dropzone's default `file-selector` aggregator, which calls
 *  `FileSystemFileHandle.getFile()` on dropped items and throws
 *  "NotAllowedError: getFile on FileSystemFileHandle" in several browsers/contexts
 *  — breaking drag-and-drop upload. We don't need folder traversal for media, so a
 *  plain list from `dataTransfer.files` / `input.files` is exactly right (and uses
 *  only the synchronous `getAsFile`, never the FS-handle API). */
function filesFromEvent(event: DropEvent): File[] {
  const dt = (event as DragEvent).dataTransfer
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
}

export function MediaDropzone({
  apiBase,
  onUploaded,
  onError,
  onBusy,
  disabled,
  children,
  upload = uploadFile,
  accept
}: MediaDropzoneProps) {
  const onDrop = useCallback(
    async (files: File[]) => {
      onBusy?.(true)
      try {
        for (const file of files) onUploaded(await upload(apiBase, file))
      } catch (err) {
        onError?.(err instanceof Error ? err.message : String(err))
      } finally {
        onBusy?.(false)
      }
    },
    [apiBase, onUploaded, onError, onBusy, upload]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    disabled,
    getFilesFromEvent: (event) => Promise.resolve(filesFromEvent(event))
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
      {children ?? <p>Drag images here, or click to upload</p>}
    </div>
  )
}

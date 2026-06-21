import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { useDropzone, type Accept, type DropzoneInputProps } from 'react-dropzone'
import { uploadFile, type UploadResult } from './upload-client'

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

export function MediaDropzone({ apiBase, onUploaded, onError, onBusy, disabled, children, upload = uploadFile, accept }: MediaDropzoneProps) {
  const onDrop = useCallback(async (files: File[]) => {
    onBusy?.(true)
    try {
      for (const file of files) onUploaded(await upload(apiBase, file))
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err))
    } finally {
      onBusy?.(false)
    }
  }, [apiBase, onUploaded, onError, onBusy, upload])

  // useFsAccessApi:false forces the classic <input type=file> path. The File System
  // Access API path (the default) throws "NotAllowedError: getFile on
  // FileSystemFileHandle" in several contexts (non-top-level gesture, some browsers),
  // breaking click-to-upload. The classic path is universally reliable.
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept, disabled, useFsAccessApi: false })

  return (
    <div {...getRootProps()} className="media-dropzone" data-drag-active={isDragActive ? '' : undefined}>
      <input {...getInputProps({ 'data-testid': 'media-dropzone-input' } as DropzoneInputProps)} />
      {children ?? <p className="muted">Drag images here, or click to upload</p>}
    </div>
  )
}

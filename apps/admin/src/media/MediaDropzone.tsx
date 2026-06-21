import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { useDropzone, type DropzoneInputProps } from 'react-dropzone'
import { uploadFile, type UploadResult } from './upload-client'

export interface MediaDropzoneProps {
  apiBase: string
  onUploaded: (result: UploadResult) => void
  onError?: (msg: string) => void
  onBusy?: (busy: boolean) => void
  disabled?: boolean
  children?: ReactNode
  upload?: typeof uploadFile
}

export function MediaDropzone({ apiBase, onUploaded, onError, onBusy, disabled, children, upload = uploadFile }: MediaDropzoneProps) {
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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'image/*': [] }, disabled })

  return (
    <div {...getRootProps()} className="media-dropzone" data-drag-active={isDragActive ? '' : undefined}>
      <input {...getInputProps({ 'data-testid': 'media-dropzone-input' } as DropzoneInputProps)} />
      {children ?? <p className="muted">Drag images here, or click to upload</p>}
    </div>
  )
}

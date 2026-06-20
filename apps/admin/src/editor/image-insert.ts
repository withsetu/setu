import type { Editor } from '@tiptap/core'
import { uploadFile, type UploadResult } from '../media/upload-client'

export function srcFromUploadUrl(url: string): string {
  return new URL(url).pathname
}

export interface ImageBlockSpec {
  type: 'imageBlock'
  attrs: { mdAttrs: { src: string; align: 'none' } }
}

export function imageNodeFromUpload(result: UploadResult): ImageBlockSpec {
  if (!result.contentType.startsWith('image/')) {
    throw new Error(`not an image: ${result.contentType}`)
  }
  return { type: 'imageBlock', attrs: { mdAttrs: { src: srcFromUploadUrl(result.url), align: 'none' } } }
}

export interface InsertHandlers {
  onUploading?: (busy: boolean) => void
  onError?: (msg: string) => void
}

/** Open an image file picker; on pick, upload via the media service and hand the result
 *  to `onResult`. Busy/error are reported through `handlers`. The single upload primitive. */
export function pickAndUploadImage(
  apiBase: string,
  handlers: InsertHandlers,
  onResult: (result: UploadResult) => void,
  upload: typeof uploadFile = uploadFile,
): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    handlers.onUploading?.(true)
    try {
      onResult(await upload(apiBase, file))
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err.message : String(err))
    } finally {
      handlers.onUploading?.(false)
    }
  }
  input.click()
}

/** Pick + upload, then insert a new imageBlock at the selection. */
export function pickImageAndInsert(
  editor: Editor,
  apiBase: string,
  handlers: InsertHandlers = {},
  upload: typeof uploadFile = uploadFile,
): void {
  pickAndUploadImage(apiBase, handlers, (result) => {
    editor.chain().focus().insertContent(imageNodeFromUpload(result)).run()
  }, upload)
}

/** Pick + upload, then hand the new path-only src to `onSrc` (the node-view Replace action). */
export function replaceImage(
  apiBase: string,
  handlers: InsertHandlers,
  onSrc: (src: string) => void,
  upload: typeof uploadFile = uploadFile,
): void {
  pickAndUploadImage(apiBase, handlers, (result) => {
    if (!result.contentType.startsWith('image/')) {
      handlers.onError?.(`not an image: ${result.contentType}`)
      return
    }
    onSrc(srcFromUploadUrl(result.url))
  }, upload)
}

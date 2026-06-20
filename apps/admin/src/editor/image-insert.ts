import type { Editor } from '@tiptap/core'
import { uploadFile, type UploadResult } from '../media/upload-client'

export function srcFromUploadUrl(url: string): string {
  return new URL(url).pathname
}

export interface ImageNodeSpec {
  type: 'image'
  attrs: { src: string; alt: string; title: null }
}

export function imageNodeFromUpload(result: UploadResult): ImageNodeSpec {
  if (!result.contentType.startsWith('image/')) {
    throw new Error(`not an image: ${result.contentType}`)
  }
  return { type: 'image', attrs: { src: srcFromUploadUrl(result.url), alt: '', title: null } }
}

export interface InsertHandlers {
  onUploading?: (busy: boolean) => void
  onError?: (msg: string) => void
}

/** Open an image file picker; on pick, upload via the media service and insert the
 *  image node at the selection. Busy/error are reported through `handlers`. */
export function pickImageAndInsert(
  editor: Editor,
  apiBase: string,
  handlers: InsertHandlers = {},
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
      const result = await upload(apiBase, file)
      editor.chain().focus().insertContent(imageNodeFromUpload(result)).run()
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err.message : String(err))
    } finally {
      handlers.onUploading?.(false)
    }
  }
  input.click()
}

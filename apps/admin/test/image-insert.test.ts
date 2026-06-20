import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { ImageBlock } from '../src/editor/extensions/ImageBlock'
import { srcFromUploadUrl, imageNodeFromUpload, pickImageAndInsert, replaceImage } from '../src/editor/image-insert'
import type { UploadResult } from '../src/media/upload-client'

afterEach(() => vi.restoreAllMocks())

const result = (over: Partial<UploadResult> = {}): UploadResult => ({
  id: '2026/06/cat', key: '2026/06/cat.png', url: 'http://localhost:4444/media/2026/06/cat.png',
  contentType: 'image/png', size: 4, filename: 'cat.png', ...over,
})

describe('srcFromUploadUrl', () => {
  it('strips the host to a root-relative path', () => {
    expect(srcFromUploadUrl('http://localhost:4444/media/2026/06/cat.png')).toBe('/media/2026/06/cat.png')
  })
})

describe('imageNodeFromUpload', () => {
  it('builds an imageBlock spec with path-only src and align none', () => {
    expect(imageNodeFromUpload(result())).toEqual({
      type: 'imageBlock', attrs: { mdAttrs: { src: '/media/2026/06/cat.png', align: 'none' } },
    })
  })
  it('throws when the upload result is not an image', () => {
    expect(() => imageNodeFromUpload(result({ contentType: 'application/pdf' }))).toThrow(/not an image/)
  })
})

describe('pickImageAndInsert', () => {
  function makeEditor() {
    return new Editor({ extensions: [StarterKit, ImageBlock], content: { type: 'doc', content: [{ type: 'paragraph' }] } })
  }
  it('uploads the picked file and inserts an imageBlock; reports busy true then false', async () => {
    const editor = makeEditor()
    const upload = vi.fn().mockResolvedValue(result())
    const onUploading = vi.fn(); const onError = vi.fn()
    const input = document.createElement('input')
    vi.spyOn(document, 'createElement').mockReturnValueOnce(input)
    vi.spyOn(input, 'click').mockImplementation(() => {})
    pickImageAndInsert(editor, 'http://localhost:4444', { onUploading, onError }, upload)
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' })] })
    await input.onchange?.(new Event('change'))
    const node = editor.getJSON().content?.find((n) => n.type === 'imageBlock')
    expect(node).toMatchObject({ type: 'imageBlock', attrs: { mdAttrs: { src: '/media/2026/06/cat.png' } } })
    expect(onUploading.mock.calls).toEqual([[true], [false]])
    expect(onError).not.toHaveBeenCalled()
    editor.destroy()
  })
  it('reports the error and inserts nothing on a failed upload', async () => {
    const editor = makeEditor()
    const upload = vi.fn().mockRejectedValue(new Error('file too large'))
    const onError = vi.fn()
    const input = document.createElement('input')
    vi.spyOn(document, 'createElement').mockReturnValueOnce(input)
    vi.spyOn(input, 'click').mockImplementation(() => {})
    pickImageAndInsert(editor, 'http://localhost:4444', { onError }, upload)
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1])], 'big.png', { type: 'image/png' })] })
    await input.onchange?.(new Event('change'))
    expect(onError).toHaveBeenCalledWith('file too large')
    expect(editor.getJSON().content?.find((n) => n.type === 'imageBlock')).toBeUndefined()
    editor.destroy()
  })
})

describe('replaceImage', () => {
  it('uploads the picked file and calls onSrc with the path-only src', async () => {
    const upload = vi.fn().mockResolvedValue(result({ url: 'http://localhost:4444/media/2026/06/xyz.png' }))
    const onSrc = vi.fn(); const onUploading = vi.fn()
    const input = document.createElement('input')
    vi.spyOn(document, 'createElement').mockReturnValueOnce(input)
    vi.spyOn(input, 'click').mockImplementation(() => {})
    replaceImage('http://localhost:4444', { onUploading }, onSrc, upload)
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1])], 'x.png', { type: 'image/png' })] })
    await input.onchange?.(new Event('change'))
    expect(onSrc).toHaveBeenCalledWith('/media/2026/06/xyz.png')
    expect(onUploading.mock.calls).toEqual([[true], [false]])
  })
  it('rejects non-image uploads and calls onError without calling onSrc', async () => {
    const upload = vi.fn().mockResolvedValue(result({ contentType: 'application/pdf' }))
    const onSrc = vi.fn(); const onError = vi.fn()
    const input = document.createElement('input')
    vi.spyOn(document, 'createElement').mockReturnValueOnce(input)
    vi.spyOn(input, 'click').mockImplementation(() => {})
    replaceImage('http://localhost:4444', { onError }, onSrc, upload)
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1])], 'doc.pdf', { type: 'application/pdf' })] })
    await input.onchange?.(new Event('change'))
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/not an image/))
    expect(onSrc).not.toHaveBeenCalled()
  })
})

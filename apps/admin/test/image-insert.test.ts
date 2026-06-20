import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Image } from '../src/editor/extensions/Image'
import { srcFromUploadUrl, imageNodeFromUpload, pickImageAndInsert } from '../src/editor/image-insert'
import type { UploadResult } from '../src/media/upload-client'

afterEach(() => vi.restoreAllMocks())

const result = (over: Partial<UploadResult> = {}): UploadResult => ({
  id: 'abc', key: 'media/abc/original.png', url: 'http://localhost:4444/uploads/media/abc/original.png',
  contentType: 'image/png', size: 4, filename: 'cat.png', ...over,
})

describe('srcFromUploadUrl', () => {
  it('strips the host to a root-relative path', () => {
    expect(srcFromUploadUrl('http://localhost:4444/uploads/media/abc/original.png')).toBe('/uploads/media/abc/original.png')
  })
})

describe('imageNodeFromUpload', () => {
  it('builds an image node with the path-only src, empty alt, null title', () => {
    expect(imageNodeFromUpload(result())).toEqual({
      type: 'image', attrs: { src: '/uploads/media/abc/original.png', alt: '', title: null },
    })
  })
  it('throws when the upload result is not an image', () => {
    expect(() => imageNodeFromUpload(result({ contentType: 'application/pdf' }))).toThrow(/not an image/)
  })
})

describe('pickImageAndInsert', () => {
  function makeEditor() {
    return new Editor({ extensions: [StarterKit, Image], content: { type: 'doc', content: [{ type: 'paragraph' }] } })
  }

  it('uploads the picked file and inserts the image node; reports busy true then false', async () => {
    const editor = makeEditor()
    const upload = vi.fn().mockResolvedValue(result())
    const onUploading = vi.fn()
    const onError = vi.fn()

    // Capture the input element pickImageAndInsert creates.
    const input = document.createElement('input')
    vi.spyOn(document, 'createElement').mockReturnValueOnce(input)
    vi.spyOn(input, 'click').mockImplementation(() => {})

    pickImageAndInsert(editor, 'http://localhost:4444', { onUploading, onError }, upload)

    // Simulate the user choosing a file.
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' })] })
    await input.onchange?.(new Event('change'))

    const node = editor.getJSON().content?.[0]?.content?.[0]
    expect(node).toMatchObject({ type: 'image', attrs: { src: '/uploads/media/abc/original.png' } })
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
    expect(editor.getJSON().content?.[0]?.content ?? []).toEqual([]) // empty paragraph, nothing inserted
    editor.destroy()
  })
})

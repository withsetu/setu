import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MediaDropzone } from '../src/media/MediaDropzone'
import type { UploadResult } from '../src/media/upload-client'

const result: UploadResult = {
  id: '2026/06/cat',
  key: '2026/06/cat.png',
  url: 'http://x/media/2026/06/cat.png',
  contentType: 'image/png',
  size: 1,
  filename: 'cat.png',
  record: {
    mediaKey: '2026/06/cat',
    key: '2026/06/cat.png',
    thumbKey: null,
    filename: 'cat.png',
    contentType: 'image/png',
    isImage: true,
    width: null,
    height: null,
    bytes: 1,
    uploadedAt: 0
  }
}

describe('MediaDropzone', () => {
  it('uploads a dropped/selected file and calls onUploaded with the result', async () => {
    const upload = vi.fn(async () => result)
    const onUploaded = vi.fn()
    render(
      <MediaDropzone
        apiBase="http://x"
        onUploaded={onUploaded}
        upload={upload}
      />
    )
    const input = screen.getByTestId('media-dropzone-input')
    const file = new File([new Uint8Array([1])], 'cat.png', {
      type: 'image/png'
    })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(result))
    expect(upload).toHaveBeenCalledWith('http://x', file)
  })

  it('uploads files dropped via drag-and-drop (custom getFilesFromEvent, no FS-handle path)', async () => {
    const upload = vi.fn(async () => result)
    const onUploaded = vi.fn()
    render(
      <MediaDropzone
        apiBase="http://x"
        onUploaded={onUploaded}
        upload={upload}
      />
    )
    const zone = screen.getByTestId('media-dropzone-input')
      .parentElement as HTMLElement
    const file = new File([new Uint8Array([1])], 'cat.png', {
      type: 'image/png'
    })
    // A drop event carrying files on dataTransfer — the path that hit the
    // file-selector getAsFileSystemHandle().getFile() NotAllowedError in browsers.
    fireEvent.drop(zone, {
      dataTransfer: {
        files: [file],
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
        types: ['Files']
      }
    })
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(result))
    expect(upload).toHaveBeenCalledWith('http://x', file)
  })

  it('reports a failed ingest through onError AFTER handing over the (still usable) upload (#1161)', async () => {
    const failed: UploadResult = { ...result, ingestFailed: true }
    const upload = vi.fn(async () => failed)
    const onUploaded = vi.fn()
    const onError = vi.fn()
    render(
      <MediaDropzone
        apiBase="http://x"
        onUploaded={onUploaded}
        onError={onError}
        upload={upload}
      />
    )
    const input = screen.getByTestId('media-dropzone-input')
    const file = new File([new Uint8Array([1])], 'cat.png', {
      type: 'image/png'
    })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(onUploaded).toHaveBeenCalledWith(failed)
    expect(String(onError.mock.calls[0]![0])).toMatch(/cat\.png.*Reprocess/)
  })

  it('a clean ingest reports nothing through onError', async () => {
    const upload = vi.fn(async () => ({ ...result, ingestFailed: false }))
    const onUploaded = vi.fn()
    const onError = vi.fn()
    render(
      <MediaDropzone
        apiBase="http://x"
        onUploaded={onUploaded}
        onError={onError}
        upload={upload}
      />
    )
    fireEvent.change(screen.getByTestId('media-dropzone-input'), {
      target: {
        files: [
          new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' })
        ]
      }
    })
    await waitFor(() => expect(onUploaded).toHaveBeenCalled())
    expect(onError).not.toHaveBeenCalled()
  })
})

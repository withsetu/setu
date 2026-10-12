import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  MediaDropzone,
  filesFromEvent,
  rejectionMessage
} from '../src/media/MediaDropzone'
import type { FileRejection } from 'react-dropzone'
import type { UploadResult } from '../src/media/upload-client'
import { MediaTransportError } from '../src/media/media-client'

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

  // #1234: a pasted file (a screenshot on Ctrl/Cmd+V) runs the same pipeline as a drop.
  describe('paste-to-upload (#1234)', () => {
    const shot = () =>
      new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
    const clipboard = (files: File[], types = ['Files']) => ({
      files,
      items: files.map((f) => ({
        kind: 'file',
        type: f.type,
        getAsFile: () => f
      })),
      types
    })
    const zoneOf = () =>
      screen.getByTestId('media-dropzone-input').parentElement as HTMLElement

    it('uploads a pasted image', async () => {
      const upload = vi.fn(async () => result)
      const onUploaded = vi.fn()
      render(
        <MediaDropzone
          apiBase="http://x"
          onUploaded={onUploaded}
          upload={upload}
          accept={{ 'image/*': [] }}
        />
      )
      const file = shot()
      fireEvent.paste(zoneOf(), { clipboardData: clipboard([file]) })
      await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(result))
      expect(upload).toHaveBeenCalledWith('http://x', file)
    })

    it('reports a pasted file the picker does not accept, and uploads nothing', async () => {
      const upload = vi.fn(async () => result)
      const onError = vi.fn()
      render(
        <MediaDropzone
          apiBase="http://x"
          onUploaded={vi.fn()}
          onError={onError}
          upload={upload}
          accept={{ 'image/*': [] }}
          acceptLabel="images"
        />
      )
      const pdf = new File([new Uint8Array([1])], 'notes.pdf', {
        type: 'application/pdf'
      })
      fireEvent.paste(zoneOf(), { clipboardData: clipboard([pdf]) })
      await waitFor(() =>
        expect(onError).toHaveBeenCalledWith(
          "notes.pdf can't be added — this picker accepts images."
        )
      )
      expect(upload).not.toHaveBeenCalled()
    })

    it('leaves a text paste alone', async () => {
      const upload = vi.fn(async () => result)
      render(
        <MediaDropzone
          apiBase="http://x"
          onUploaded={vi.fn()}
          upload={upload}
        />
      )
      const notCancelled = fireEvent.paste(zoneOf(), {
        clipboardData: { files: [], items: [], types: ['text/plain'] }
      })
      expect(notCancelled).toBe(true)
      await new Promise((r) => setTimeout(r, 20))
      expect(upload).not.toHaveBeenCalled()
    })

    it('reads files from clipboardData', () => {
      const file = shot()
      const event = {
        clipboardData: clipboard([file])
      } as unknown as ClipboardEvent
      expect(filesFromEvent(event)).toEqual([file])
    })
  })

  it('treats a FileSystemFileHandle list as a hard error, never an empty drop (#1232)', () => {
    // Only reachable with useFsAccessApi, which MediaDropzone sets false: the handle API is the
    // getFile() NotAllowedError path filesFromEvent exists to avoid.
    expect(() => filesFromEvent([])).toThrow(/useFsAccessApi/)
  })

  // #1233: a drop the `accept` filter rejects used to vanish: no upload, no message.
  describe('rejected drops are reported, not dropped silently (#1233)', () => {
    const pdf = () =>
      new File([new Uint8Array([1])], 'notes.pdf', { type: 'application/pdf' })
    const png = () =>
      new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' })
    const drop = (files: File[]) => {
      const zone = screen.getByTestId('media-dropzone-input')
        .parentElement as HTMLElement
      fireEvent.drop(zone, {
        dataTransfer: {
          files,
          items: files.map((f) => ({
            kind: 'file',
            type: f.type,
            getAsFile: () => f
          })),
          types: ['Files']
        }
      })
    }

    it('names the file and what the picker accepts', async () => {
      const upload = vi.fn(async () => result)
      const onError = vi.fn()
      render(
        <MediaDropzone
          apiBase="http://x"
          onUploaded={vi.fn()}
          onError={onError}
          upload={upload}
          accept={{ 'image/*': [] }}
          acceptLabel="images"
        />
      )
      drop([pdf()])
      await waitFor(() =>
        expect(onError).toHaveBeenCalledWith(
          "notes.pdf can't be added — this picker accepts images."
        )
      )
      expect(upload).not.toHaveBeenCalled()
    })

    it('uploads the accepted files of a mixed drop and reports the rest', async () => {
      const upload = vi.fn(async () => result)
      const onUploaded = vi.fn()
      const onError = vi.fn()
      render(
        <MediaDropzone
          apiBase="http://x"
          onUploaded={onUploaded}
          onError={onError}
          upload={upload}
          accept={{ 'image/*': [] }}
          acceptLabel="images"
        />
      )
      const second = new File([new Uint8Array([1])], 'clip.mov', {
        type: 'video/quicktime'
      })
      drop([pdf(), png(), second])
      await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(result))
      expect(upload).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        "notes.pdf and 1 more can't be added — this picker accepts images."
      )
    })

    it('keeps the library reason for a rejection that is not about type', () => {
      expect(
        rejectionMessage(
          [
            {
              file: pdf() as FileRejection['file'],
              errors: [
                { code: 'file-too-large', message: 'File is larger than 5 MB' }
              ]
            }
          ],
          'images'
        )
      ).toBe("notes.pdf can't be added: File is larger than 5 MB.")
      expect(rejectionMessage([], 'images')).toBeNull()
    })

    it('says what it accepts in the hint', () => {
      render(
        <MediaDropzone
          apiBase="http://x"
          onUploaded={vi.fn()}
          accept={{ 'video/mp4': [], 'video/webm': [] }}
          acceptLabel="MP4 or WebM videos"
        />
      )
      expect(
        screen.getByText(
          'Drag MP4 or WebM videos here, paste, or click to upload'
        )
      ).toBeInTheDocument()
    })

    it('says "files" in the hint when nothing narrows what it accepts', () => {
      render(<MediaDropzone apiBase="http://x" onUploaded={vi.fn()} />)
      expect(
        screen.getByText('Drag files here, paste, or click to upload')
      ).toBeInTheDocument()
    })
  })

  // #872: the upload never reached the server → a connection message; the server answered →
  // its own reason, verbatim.
  describe('upload failures (#872)', () => {
    const drop = (
      onError: (m: string) => void,
      upload: () => Promise<never>
    ) => {
      render(
        <MediaDropzone
          apiBase="http://x"
          onUploaded={vi.fn()}
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
    }

    it('shows a connection message when the request never reached the server', async () => {
      const onError = vi.fn()
      drop(onError, async () => {
        throw new MediaTransportError(new TypeError('Failed to fetch'))
      })
      await waitFor(() =>
        expect(onError).toHaveBeenCalledWith(
          "Couldn't upload the file. Check your connection and try again."
        )
      )
    })

    it("shows the server's reason when the server refused the upload", async () => {
      const onError = vi.fn()
      drop(onError, async () => {
        throw new Error('file is too large (max 25 MB)')
      })
      await waitFor(() =>
        expect(onError).toHaveBeenCalledWith('file is too large (max 25 MB)')
      )
    })
  })

  // #840: the dropzone is every live upload path (Media library, editor picker, featured image),
  // and none of them showed anything while a file uploaded.
  describe('shows the upload in progress (#840)', () => {
    const png = (name: string) =>
      new File([new Uint8Array([1])], name, { type: 'image/png' })

    it('names the file while it uploads, then returns to the hint', async () => {
      let finish!: (r: UploadResult) => void
      const upload = vi.fn(
        () => new Promise<UploadResult>((resolve) => (finish = resolve))
      )
      render(
        <MediaDropzone
          apiBase="http://x"
          onUploaded={vi.fn()}
          upload={upload}
        />
      )
      fireEvent.change(screen.getByTestId('media-dropzone-input'), {
        target: { files: [png('cat.png')] }
      })
      const status = await screen.findByRole('status')
      expect(status).toHaveTextContent('Uploading cat.png…')
      finish(result)
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
      expect(
        screen.getByText('Drag files here, paste, or click to upload')
      ).toBeInTheDocument()
    })

    it('counts through a multi-file drop', async () => {
      const finishers: Array<(r: UploadResult) => void> = []
      const upload = vi.fn(
        () => new Promise<UploadResult>((resolve) => finishers.push(resolve))
      )
      render(
        <MediaDropzone
          apiBase="http://x"
          onUploaded={vi.fn()}
          upload={upload}
        />
      )
      fireEvent.change(screen.getByTestId('media-dropzone-input'), {
        target: { files: [png('a.png'), png('b.png')] }
      })
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Uploading a.png (1 of 2)…'
      )
      finishers[0]!(result)
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          'Uploading b.png (2 of 2)…'
        )
      )
      finishers[1]!(result)
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    })

    it('clears the progress when the upload fails', async () => {
      render(
        <MediaDropzone
          apiBase="http://x"
          onUploaded={vi.fn()}
          onError={vi.fn()}
          upload={async () => {
            throw new Error('nope')
          }}
        />
      )
      fireEvent.change(screen.getByTestId('media-dropzone-input'), {
        target: { files: [png('cat.png')] }
      })
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
      expect(
        screen.getByText('Drag files here, paste, or click to upload')
      ).toBeInTheDocument()
    })
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMediaIndexService } from '@setu/core'
import { createMemoryMediaIndexPort } from '@setu/db-memory'
import { MediaIndexProvider } from '../src/data/media-index-store'
import { NotificationProvider } from '../src/ui/notify'
import { MediaListControl } from '../src/editor/controls/media-list'
import { controlRegistry } from '../src/editor/controls/registry'
import type { MediaRecord } from '@setu/core'

// MediaListControl mounts MediaPickerModal, which calls useNotify() (#756).
const wrapper = NotificationProvider

const meta = {
  name: 'images',
  apiBase: 'http://x',
  onPickMedia: () => {}
}

const IMAGES = [
  { src: '/media/2026/07/a.webp', alt: 'First' },
  { src: '/media/2026/07/b.webp', caption: 'Sea' }
]

describe('MediaListControl', () => {
  it('is registered as the media-list control', () => {
    expect(controlRegistry['media-list']).toBe(MediaListControl)
  })

  it('renders a thumbnail + alt/caption inputs per image', () => {
    const { container } = render(
      <MediaListControl value={IMAGES} onChange={() => {}} meta={meta} />,
      { wrapper }
    )
    // decorative thumbnails (alt="") have no img role — query the elements directly
    const thumbs = container.querySelectorAll('img')
    expect(thumbs.length).toBe(2)
    expect(thumbs[0]!.getAttribute('src')).toBe('http://x/media/2026/07/a.webp')
    const alt1 = screen.getByLabelText<HTMLInputElement>('Alt text for image 1')
    expect(alt1.value).toBe('First')
    expect(
      screen.getByLabelText<HTMLInputElement>('Caption for image 2').value
    ).toBe('Sea')
  })

  it('writes alt edits back as a new images array', () => {
    const onChange = vi.fn()
    render(
      <MediaListControl value={IMAGES} onChange={onChange} meta={meta} />,
      {
        wrapper
      }
    )
    fireEvent.change(screen.getByLabelText('Alt text for image 2'), {
      target: { value: 'Beach' }
    })
    expect(onChange).toHaveBeenCalledWith([
      IMAGES[0],
      { src: '/media/2026/07/b.webp', alt: 'Beach', caption: 'Sea' }
    ])
  })

  it('reorders with move up/down and removes items', () => {
    const onChange = vi.fn()
    render(
      <MediaListControl value={IMAGES} onChange={onChange} meta={meta} />,
      {
        wrapper
      }
    )
    // first item cannot move up, last cannot move down
    expect(screen.getByLabelText('Move image 1 up')).toBeDisabled()
    expect(screen.getByLabelText('Move image 2 down')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Move image 2 up'))
    expect(onChange).toHaveBeenLastCalledWith([IMAGES[1], IMAGES[0]])
    fireEvent.click(screen.getByLabelText('Remove image 1'))
    expect(onChange).toHaveBeenLastCalledWith([IMAGES[1]])
  })

  it('adds images from the library picker, staying open for multi-pick', async () => {
    const rec: MediaRecord = {
      mediaKey: '2026/06/cat',
      key: '2026/06/cat.png',
      thumbKey: '2026/06/cat-400w.webp',
      filename: 'cat.png',
      contentType: 'image/png',
      isImage: true,
      width: 8,
      height: 6,
      bytes: 1,
      uploadedAt: 1
    }
    const svc = createMediaIndexService({
      mediaIndex: createMemoryMediaIndexPort(),
      fetchRaw: async () => [rec]
    })
    await svc.ensureBuilt()
    const onChange = vi.fn()
    render(
      <MediaIndexProvider service={svc}>
        <MediaListControl value={[]} onChange={onChange} meta={meta} />
      </MediaIndexProvider>,
      { wrapper }
    )
    fireEvent.click(screen.getByRole('button', { name: /add images/i }))
    await waitFor(() => expect(screen.getByText('cat.png')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    expect(onChange).toHaveBeenCalledWith([{ src: '/media/2026/06/cat.png' }])
    // multi-pick: the dialog stays open with a Done affordance
    expect(screen.getByText('cat.png')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    await waitFor(() =>
      expect(screen.queryByText('cat.png')).not.toBeInTheDocument()
    )
  })

  it('appends EVERY file of a multi-file upload, in selection order (#177 UAT defect)', async () => {
    // The dropzone's in-flight upload loop captures ONE onUploaded closure and fires
    // it once per file — if append folds onto render-time items, the last write wins
    // and only one image survives. Reproduces the owner-UAT defect: upload two files
    // at once, expect BOTH appended.
    const svc = createMediaIndexService({
      mediaIndex: createMemoryMediaIndexPort(),
      fetchRaw: async () => []
    })
    await svc.ensureBuilt()
    let uploads = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      if (url.endsWith('/media')) {
        uploads += 1
        const name = uploads === 1 ? 'first' : 'second'
        return new Response(
          JSON.stringify({ url: `http://x/media/2026/07/${name}.png` }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const onChange = vi.fn()
      render(
        <MediaIndexProvider service={svc}>
          <MediaListControl value={[]} onChange={onChange} meta={meta} />
        </MediaIndexProvider>,
        { wrapper }
      )
      fireEvent.click(screen.getByRole('button', { name: /add images/i }))
      const input = await screen.findByTestId('media-dropzone-input')
      expect(input).toHaveAttribute('multiple') // multi-select enabled in pick mode
      fireEvent.change(input, {
        target: {
          files: [
            new File(['a'], 'first.png', { type: 'image/png' }),
            new File(['b'], 'second.png', { type: 'image/png' })
          ]
        }
      })
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(onChange).toHaveBeenLastCalledWith([
          { src: '/media/2026/07/first.png' },
          { src: '/media/2026/07/second.png' }
        ])
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

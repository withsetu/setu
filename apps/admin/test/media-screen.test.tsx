import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import * as client from '../src/media/upload-client'
import { Media } from '../src/screens/Media'

afterEach(() => vi.restoreAllMocks())

function pickFile() {
  const input = screen.getByTestId('media-file-input') as HTMLInputElement
  const file = new File([new Uint8Array([1, 2])], 'a.png', { type: 'image/png' })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('Media screen', () => {
  it('uploads a picked file and shows the link + image preview', async () => {
    vi.spyOn(client, 'uploadFile').mockResolvedValue({
      id: '1', key: 'media/1/original.png', url: 'http://api/uploads/media/1/original.png',
      contentType: 'image/png', size: 2, filename: 'a.png',
      record: { mediaKey: '1', key: 'media/1/original.png', thumbKey: null, filename: 'a.png', contentType: 'image/png', isImage: true, width: null, height: null, bytes: 2, uploadedAt: 0 },
    })
    render(<Media />)
    pickFile()
    const link = await screen.findByRole('link', { name: /a\.png/ })
    expect(link).toHaveAttribute('href', 'http://api/uploads/media/1/original.png')
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://api/uploads/media/1/original.png')
  })

  it('shows the error message when the upload fails', async () => {
    vi.spyOn(client, 'uploadFile').mockRejectedValue(new Error('file too large'))
    render(<Media />)
    pickFile()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('file too large'))
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UploadingBanner } from '../src/editor/UploadingBanner'

// #840: the editor's upload status was a bare, unstyled <div>. It is announced as a status and
// carries the same spinner as the editor's own "Saving…".
describe('UploadingBanner (#840)', () => {
  it('announces the upload as a status with a spinner', () => {
    render(<UploadingBanner />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Uploading image…')
    expect(status.querySelector('svg.animate-spin')).not.toBeNull()
  })
})

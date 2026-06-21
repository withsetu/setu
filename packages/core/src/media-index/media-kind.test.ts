import { describe, it, expect } from 'vitest'
import { mediaKind } from './media-kind'

describe('mediaKind', () => {
  it('maps MIME types to coarse kinds', () => {
    expect(mediaKind('image/png')).toBe('image')
    expect(mediaKind('image/webp')).toBe('image')
    expect(mediaKind('video/mp4')).toBe('video')
    expect(mediaKind('audio/mpeg')).toBe('audio')
    expect(mediaKind('application/pdf')).toBe('document')
    expect(mediaKind('text/markdown')).toBe('document')
    expect(mediaKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('document')
    expect(mediaKind('application/zip')).toBe('other')
    expect(mediaKind('application/octet-stream')).toBe('other')
  })
})

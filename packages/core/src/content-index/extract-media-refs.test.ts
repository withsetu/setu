import { describe, it, expect } from 'vitest'
import { extractMediaRefs } from './extract-media-refs'

describe('extractMediaRefs', () => {
  it('extracts from {% image %} blocks and inline markdown, normalizes to mediaKey', () => {
    const body = [
      '{% image src="/media/2026/06/cat.jpg" align="wide" /%}',
      '![a dog](/media/2026/05/dog.png)'
    ].join('\n')
    expect(extractMediaRefs(body).sort()).toEqual([
      '2026/05/dog',
      '2026/06/cat'
    ])
  })
  it('strips a -<width>w variant suffix and dedupes', () => {
    const body = '/media/2026/06/cat-800w.webp /media/2026/06/cat.jpg'
    expect(extractMediaRefs(body)).toEqual(['2026/06/cat'])
  })
  it('strips a .<width>w variant suffix (#1159 variant naming)', () => {
    const body = '/media/2026/06/cat.800w.webp /media/2026/06/cat.400w.avif'
    expect(extractMediaRefs(body)).toEqual(['2026/06/cat'])
    // the new suffix is unambiguous: never fall through to the legacy strip after it
    expect(extractMediaRefs('/media/2026/06/cat-400w.800w.webp')).toEqual([
      '2026/06/cat-400w'
    ])
  })
  it('returns [] when there are no media refs', () => {
    expect(extractMediaRefs('just text, no images')).toEqual([])
  })
})

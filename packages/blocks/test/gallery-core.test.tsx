import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Gallery } from '../src/gallery/Gallery'
import {
  galleryClasses,
  galleryImagesOf,
  sizesForColumns
} from '../src/gallery/gallery-classes'

describe('Gallery canvas core', () => {
  it('renders one figure per image with per-image alt', () => {
    const { container } = render(
      <Gallery
        images={[
          { src: '/media/a.webp', alt: 'First' },
          { src: '/media/b.webp' }
        ]}
        columns={2}
        gap="small"
      />
    )
    expect(
      container.querySelector('.blk-gallery.cols-2.gap-small')
    ).toBeTruthy()
    const imgs = container.querySelectorAll('.blk-gallery-item img')
    expect(imgs.length).toBe(2)
    expect(imgs[0]!.getAttribute('alt')).toBe('First')
    expect(imgs[1]!.getAttribute('alt')).toBe('')
  })

  it('shows captions only when the captions prop is on', () => {
    const images = [{ src: '/media/a.webp', caption: 'By the sea' }]
    const { container, rerender } = render(
      <Gallery images={images} captions={false} />
    )
    expect(container.querySelector('.blk-gallery-caption')).toBeNull()
    rerender(<Gallery images={images} captions />)
    expect(screen.getByText('By the sea')).toBeInTheDocument()
  })

  it('renders an inviting empty state instead of an empty grid', () => {
    const { container } = render(<Gallery images={[]} />)
    expect(container.querySelector('.blk-gallery-empty')).toBeTruthy()
    expect(screen.getByText(/add images/i)).toBeInTheDocument()
    expect(container.textContent).not.toContain('undefined')
  })

  it('marks wide/full width intent as classes', () => {
    const { container } = render(
      <Gallery images={[{ src: '/media/a.webp' }]} width="wide" />
    )
    expect(container.querySelector('.blk-gallery.w-wide')).toBeTruthy()
  })
})

describe('gallery class + attr helpers', () => {
  it('clamps columns into 1..6 and defaults to 3', () => {
    expect(galleryClasses(undefined, undefined, undefined)).toContain('cols-3')
    expect(galleryClasses(9, 'medium', 'none')).toContain('cols-6')
    expect(galleryClasses(0, 'medium', 'none')).toContain('cols-1')
  })

  it('galleryImagesOf keeps only well-formed items from unknown attrs', () => {
    expect(galleryImagesOf(undefined)).toEqual([])
    expect(galleryImagesOf('nope')).toEqual([])
    expect(
      galleryImagesOf([
        { src: '/media/a.webp', alt: 'A', caption: 'cap' },
        { src: '' },
        { alt: 'no src' },
        'bogus',
        { src: '/media/b.webp', alt: 7 }
      ])
    ).toEqual([
      { src: '/media/a.webp', alt: 'A', caption: 'cap' },
      { src: '/media/b.webp' }
    ])
  })

  it('sizesForColumns narrows the slot estimate as columns grow', () => {
    expect(sizesForColumns(1)).toBe('100vw')
    expect(sizesForColumns(4)).toContain('25vw')
  })
})

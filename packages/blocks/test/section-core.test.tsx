import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { Section } from '../src/section/Section'
import { sectionClasses } from '../src/section/section-classes'

afterEach(cleanup)

describe('sectionClasses', () => {
  it('defaults emit a plain md-padded band (no bg-, no w- class)', () => {
    expect(sectionClasses()).toBe('blk-section pad-md')
  })
  it('background/padding/width map to namespaced modifier classes', () => {
    expect(sectionClasses('soft', 'lg', 'wide')).toBe(
      'blk-section pad-lg bg-soft w-wide'
    )
    expect(sectionClasses('accent', 'none', 'full')).toBe(
      'blk-section pad-none bg-accent w-full'
    )
    expect(sectionClasses('inverted', 'sm', 'none')).toBe(
      'blk-section pad-sm bg-inverted'
    )
  })
  it('a background image adds has-media', () => {
    expect(sectionClasses('none', 'md', 'none', true)).toBe(
      'blk-section pad-md has-media'
    )
  })
  it("tolerates the legacy width sentinel 'normal' as an alias for 'none'", () => {
    expect(sectionClasses('soft', 'md', 'normal')).toBe(
      'blk-section pad-md bg-soft'
    )
  })
  it('clamps unknown values to defaults — no class injection from hand-authored markdoc', () => {
    // Markdoc validation is non-blocking; hand-authored attrs reach the renderer as-is.
    expect(sectionClasses('soft x', 'md', 'wide')).toBe(
      'blk-section pad-md w-wide'
    )
    expect(sectionClasses('accent', 'lg; }', 'full')).toBe(
      'blk-section pad-md bg-accent w-full'
    )
    expect(sectionClasses('none', 'md', '100vw evil-class')).toBe(
      'blk-section pad-md'
    )
    // every emitted token stays within the allowlisted vocabulary
    const cls = sectionClasses('"><script>', 'x y', 'z', true)
    const ALLOWED = new Set([
      'blk-section',
      'pad-none',
      'pad-sm',
      'pad-md',
      'pad-lg',
      'bg-soft',
      'bg-accent',
      'bg-inverted',
      'w-wide',
      'w-full',
      'has-media'
    ])
    for (const token of cls.split(' ')) {
      expect(ALLOWED.has(token), `unexpected class token "${token}"`).toBe(true)
    }
  })
})

describe('Section core', () => {
  it('renders children inside .blk-section-inner with the band classes', () => {
    const { container } = render(
      <Section background="soft" padding="lg" width="full">
        <p>Grouped content</p>
      </Section>
    )
    const root = container.querySelector('section.blk-section')
    expect(root).toBeTruthy()
    expect(root!.className).toBe('blk-section pad-lg bg-soft w-full')
    expect(container.querySelector('.blk-section-inner p')?.textContent).toBe(
      'Grouped content'
    )
    expect(container.querySelector('.blk-section-media')).toBeNull()
  })

  it('renders sensibly with no props (defaults, no undefined on screen)', () => {
    const { container } = render(
      <Section>
        <p>Body</p>
      </Section>
    )
    expect(container.querySelector('section')!.className).toBe(
      'blk-section pad-md'
    )
    expect(container.textContent).not.toContain('undefined')
  })

  it('renders the background image layer behind the content', () => {
    render(
      <Section image="/media/2026/06/test-cat.jpg">
        <p>Over image</p>
      </Section>
    )
    const media = document.querySelector('.blk-section-media')
    expect(media).toBeTruthy()
    expect(media!.querySelector('img')!.getAttribute('src')).toBe(
      '/media/2026/06/test-cat.jpg'
    )
    expect(document.querySelector('section.blk-section')!.className).toContain(
      'has-media'
    )
    expect(screen.getByText('Over image')).toBeInTheDocument()
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Hero } from '../src/hero/Hero'

describe('Hero canvas core', () => {
  it('renders headline, subhead, CTA and layout+position classes from props', () => {
    const { container } = render(
      <Hero
        headline="Welcome"
        subhead="Build fast"
        ctaLabel="Start"
        ctaHref="/start"
        layout="split-left"
        textPosition="center"
      />
    )
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText('Build fast')).toBeInTheDocument()
    expect(screen.getByText('Start')).toBeInTheDocument()
    expect(
      container.querySelector('.blk-hero.layout-split-left.pos-center')
    ).toBeTruthy()
  })

  it('omits CTA + image when those props are absent', () => {
    const { container } = render(
      <Hero headline="Only headline" layout="centered" />
    )
    expect(container.querySelector('.blk-hero-cta')).toBeNull()
    expect(container.querySelector('.blk-hero-media')).toBeNull()
  })

  it('applies scrim CSS variable when layout is background', () => {
    const { container } = render(
      <Hero
        headline="BG hero"
        layout="background"
        textPosition="bottom-left"
        overlayColor="rgba(0,0,0,0.7)"
      />
    )
    expect(
      container.querySelector('.blk-hero.layout-background.pos-bottom-left')
    ).toBeTruthy()
    const section = container.querySelector('.blk-hero') as HTMLElement
    expect(section.style.getPropertyValue('--blk-hero-scrim')).toBe(
      'rgba(0,0,0,0.7)'
    )
  })

  // #857 — inline-style color validation, mirrored from Hero.astro.
  it('drops an injection payload in overlayColor (scrim falls back to the safe default)', () => {
    const { container } = render(
      <Hero
        headline="BG hero"
        layout="background"
        overlayColor="red;background:url(https://evil/x)"
      />
    )
    const section = container.querySelector('.blk-hero') as HTMLElement
    expect(section.style.getPropertyValue('--blk-hero-scrim')).toBe(
      'rgba(15,17,26,0.55)'
    )
  })

  it('drops an injection payload in textColor (no text-color custom property emitted)', () => {
    const { container } = render(
      <Hero headline="Hero" textColor="#fff;position:fixed;inset:0" />
    )
    const section = container.querySelector('.blk-hero') as HTMLElement
    expect(section.style.getPropertyValue('--blk-hero-text-color')).toBe('')
  })

  // #862 — a11y: no empty heading, content image carries a real alt.
  it('skips the <h2> entirely when the headline is blank (no empty-heading)', () => {
    const { container } = render(<Hero headline="   " layout="centered" />)
    expect(container.querySelector('.blk-hero-headline')).toBeNull()
    expect(container.querySelector('h2')).toBeNull()
  })

  it('gives a split-layout content image a non-empty alt (imageAlt, else headline)', () => {
    const { container } = render(
      <Hero
        headline="Build on your own terms"
        image="/media/a.jpg"
        layout="split-left"
      />
    )
    const img = container.querySelector(
      '.blk-hero-media img'
    ) as HTMLImageElement
    expect(img.getAttribute('alt')).toBe('Build on your own terms')

    const { container: c2 } = render(
      <Hero
        headline="Headline"
        image="/media/a.jpg"
        imageAlt="A team collaborating"
        layout="split-right"
      />
    )
    expect(
      (
        c2.querySelector('.blk-hero-media img') as HTMLImageElement
      ).getAttribute('alt')
    ).toBe('A team collaborating')
  })

  it('keeps the background-layout image decorative (empty alt)', () => {
    const { container } = render(
      <Hero
        headline="BG"
        image="/media/a.jpg"
        imageAlt="ignored for background"
        layout="background"
      />
    )
    const img = container.querySelector(
      '.blk-hero-media img'
    ) as HTMLImageElement
    expect(img.getAttribute('alt')).toBe('')
  })
})

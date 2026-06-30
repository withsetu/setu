import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Hero } from '../src/hero/Hero'

describe('Hero canvas core', () => {
  it('renders headline, subhead, CTA and layout+position classes from props', () => {
    const { container } = render(
      <Hero headline="Welcome" subhead="Build fast" ctaLabel="Start" ctaHref="/start" layout="split-left" textPosition="center" />,
    )
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText('Build fast')).toBeInTheDocument()
    expect(screen.getByText('Start')).toBeInTheDocument()
    expect(container.querySelector('.blk-hero.layout-split-left.pos-center')).toBeTruthy()
  })

  it('omits CTA + image when those props are absent', () => {
    const { container } = render(<Hero headline="Only headline" layout="centered" />)
    expect(container.querySelector('.blk-hero-cta')).toBeNull()
    expect(container.querySelector('.blk-hero-media')).toBeNull()
  })

  it('applies scrim CSS variable when layout is background', () => {
    const { container } = render(
      <Hero headline="BG hero" layout="background" textPosition="bottom-left" overlayColor="rgba(0,0,0,0.7)" />,
    )
    expect(container.querySelector('.blk-hero.layout-background.pos-bottom-left')).toBeTruthy()
    const section = container.querySelector('.blk-hero') as HTMLElement
    expect(section.style.getPropertyValue('--blk-hero-scrim')).toBe('rgba(0,0,0,0.7)')
  })
})

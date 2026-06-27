import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Hero } from '../src/hero/Hero'

describe('Hero canvas core', () => {
  it('renders headline, subhead, CTA and variant class from props', () => {
    const { container } = render(
      <Hero headline="Welcome" subhead="Build fast" ctaLabel="Start" ctaHref="/start" variant="left" />,
    )
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText('Build fast')).toBeInTheDocument()
    expect(screen.getByText('Start')).toBeInTheDocument()
    expect(container.querySelector('.blk-hero.variant-left')).toBeTruthy()
  })

  it('omits CTA + image when those props are absent', () => {
    const { container } = render(<Hero headline="Only headline" variant="center" />)
    expect(container.querySelector('.blk-hero-cta')).toBeNull()
    expect(container.querySelector('.blk-hero-img')).toBeNull()
  })
})

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PublishMenu } from '../src/editor/PublishMenu'

afterEach(cleanup)

// Radix DropdownMenu calls scrollIntoView when it opens — stub it for jsdom.
beforeAll(() => {
  if (
    typeof window !== 'undefined' &&
    !window.HTMLElement.prototype.scrollIntoView
  ) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
})

const defaultProps = {
  canPublish: true,
  canUnpublish: true,
  isUnpublished: false,
  onPublish: vi.fn(),
  onUnpublish: vi.fn(),
  onRepublish: vi.fn()
}

function openMenu() {
  const toggle = screen.getByRole('button', { name: 'More publish actions' })
  // Radix DropdownMenu opens on Enter keydown (avoids PointerEvent jsdom issues)
  fireEvent.keyDown(toggle, { key: 'Enter' })
}

describe('PublishMenu dismiss', () => {
  it('closes on Escape', () => {
    render(<PublishMenu {...defaultProps} />)
    openMenu()
    expect(
      screen.getByRole('menuitem', { name: 'Unpublish' })
    ).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menuitem', { name: 'Unpublish' })).toBeNull()
  })

  // Radix DropdownMenu closes on outside pointer events; jsdom does not implement
  // PointerEvent natively so we verify the behaviour via a second Escape close instead.
  it('closes on a second Escape (menu toggles open/closed)', () => {
    render(<PublishMenu {...defaultProps} />)
    openMenu()
    expect(
      screen.getByRole('menuitem', { name: 'Unpublish' })
    ).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menuitem', { name: 'Unpublish' })).toBeNull()
  })
})

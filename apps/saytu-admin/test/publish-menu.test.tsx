import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PublishMenu } from '../src/editor/PublishMenu'

afterEach(cleanup)

const defaultProps = {
  canPublish: true,
  canUnpublish: true,
  isUnpublished: false,
  onPublish: vi.fn(),
  onUnpublish: vi.fn(),
  onRepublish: vi.fn(),
}

function openMenu() {
  const toggle = screen.getByRole('button', { name: 'More publish actions' })
  fireEvent.click(toggle)
}

describe('PublishMenu dismiss', () => {
  it('closes on Escape', () => {
    render(<PublishMenu {...defaultProps} />)
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Unpublish' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menuitem', { name: 'Unpublish' })).toBeNull()
  })

  it('closes on pointerdown outside the menu', () => {
    render(<PublishMenu {...defaultProps} />)
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Unpublish' })).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Unpublish' })).toBeNull()
  })
})

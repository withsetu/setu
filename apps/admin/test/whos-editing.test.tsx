import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Lock } from '@setu/core'
import { WhosEditing } from '../src/dashboard/widgets/WhosEditing'

const lock = (over: Partial<Lock> = {}): Lock =>
  ({ collection: 'page', locale: 'en', slug: 'about', lockedBy: 'arjun', lockedAt: 0, ...over } as Lock)

describe('WhosEditing', () => {
  it('renders nothing when no one is editing', () => {
    const { container } = render(<WhosEditing locks={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('lists the lock holder and what they hold', () => {
    render(<WhosEditing locks={[lock()]} />)
    expect(screen.getByText('arjun')).toBeInTheDocument()
    expect(screen.getByText(/about/)).toBeInTheDocument()
  })
})

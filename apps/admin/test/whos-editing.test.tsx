import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WhosEditing } from '../src/dashboard/widgets/WhosEditing'

describe('WhosEditing', () => {
  it('lists each locked entry and its holder', () => {
    render(<WhosEditing locks={[{ collection: 'post', locale: 'en', slug: 'p1', lockedBy: 'sarah' }]} />)
    expect(screen.getByText(/p1/)).toBeInTheDocument()
    expect(screen.getByText(/sarah/)).toBeInTheDocument()
  })

  it('shows an empty state when nothing is being edited', () => {
    render(<WhosEditing locks={[]} />)
    expect(screen.getByText(/no one is editing/i)).toBeInTheDocument()
  })
})

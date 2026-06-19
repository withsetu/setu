import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TipsDeck } from '../src/dashboard/widgets/TipsDeck'

describe('TipsDeck', () => {
  beforeEach(() => localStorage.clear())

  it('renders bundled tips and hides after dismissal', () => {
    render(<TipsDeck />)
    expect(screen.getByText(/tips/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText(/tips/i)).not.toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StripStatus } from '../src/editor/StripStatus'

describe('StripStatus', () => {
  it('renders the draft label', () => {
    render(<StripStatus lifecycle={{ state: 'draft' }} />)
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })
  it('renders the live label', () => {
    render(<StripStatus lifecycle={{ state: 'live' }} />)
    expect(screen.getByText(/live/i)).toBeInTheDocument()
  })
  it('shows the pending suffix when present', () => {
    render(<StripStatus lifecycle={{ state: 'staged', pending: 'staged' }} />)
    expect(screen.getByText(/· staged/)).toBeInTheDocument()
  })
})

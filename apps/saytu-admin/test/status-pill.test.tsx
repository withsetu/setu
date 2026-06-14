import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusPill } from '../src/ui/StatusPill'

describe('StatusPill', () => {
  it('renders a known status with its toned class', () => {
    const { container } = render(<StatusPill status="published" />)
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(container.querySelector('.badge-green')).not.toBeNull()
  })

  it('renders an unknown status as a neutral pill with the raw label', () => {
    const { container } = render(<StatusPill status="weird" />)
    expect(screen.getByText('weird')).toBeInTheDocument()
    expect(container.querySelector('.badge-neutral')).not.toBeNull()
  })
})

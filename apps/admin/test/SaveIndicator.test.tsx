import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SaveIndicator } from '../src/editor/SaveIndicator'

describe('SaveIndicator', () => {
  it('shows Saving… while saving', () => {
    render(<SaveIndicator status="saving" readonly={false} />)
    expect(screen.getByText('Saving…')).toBeInTheDocument()
  })
  it('shows Saved when saved', () => {
    render(<SaveIndicator status="saved" readonly={false} />)
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })
  it('shows Read-only when readonly', () => {
    render(<SaveIndicator status="saved" readonly />)
    expect(screen.getByText('Read-only')).toBeInTheDocument()
  })
  it('renders nothing when idle', () => {
    const { container } = render(
      <SaveIndicator status="idle" readonly={false} />
    )
    expect(container.textContent).toBe('')
  })
})

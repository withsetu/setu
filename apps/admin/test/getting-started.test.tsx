import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GettingStarted } from '../src/dashboard/widgets/GettingStarted'

describe('GettingStarted', () => {
  beforeEach(() => localStorage.clear())

  it('renders checklist items and reflects completion', () => {
    render(<GettingStarted hasSiteUrl={true} hasPost={false} hasDeployed={false} />)
    expect(screen.getByText(/create your first post/i)).toBeInTheDocument()
    // a completed item is marked done via aria-checked
    expect(screen.getByRole('checkbox', { name: /set your site url/i })).toBeChecked()
  })

  it('disappears after dismissal', () => {
    render(<GettingStarted hasSiteUrl={false} hasPost={false} hasDeployed={false} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText(/getting started/i)).not.toBeInTheDocument()
  })
})

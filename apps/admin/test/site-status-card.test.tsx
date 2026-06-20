import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SiteStatusCard } from '../src/dashboard/widgets/SiteStatusCard'

describe('SiteStatusCard', () => {
  it('shows topology, deploy state, and a disabled Sync affordance', () => {
    render(<SiteStatusCard url="http://localhost:4321" deployedSha={null} topology="Local" />)
    expect(screen.getByText('Local')).toBeInTheDocument()
    expect(screen.getByText(/not deployed/i)).toBeInTheDocument()
    const sync = screen.getByRole('button', { name: /sync/i })
    expect(sync).toBeDisabled()
  })

  it('shows a short sha when deployed', () => {
    render(<SiteStatusCard url="http://localhost:4321" deployedSha="abcdef1234567890" topology="Local" />)
    expect(screen.getByText(/abcdef1/)).toBeInTheDocument()
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AuditResult } from '@setu/core'
import { SiteHealthCardView } from '../src/screens/dashboard/SiteHealthCard'

const audit: AuditResult = {
  results: [],
  score: 64,
  band: 'needs-work',
  byCategory: [],
  mustHaves: { done: 4, total: 7 }
}

describe('SiteHealthCardView', () => {
  it('shows the score, band, and must-have tally', () => {
    render(
      <MemoryRouter>
        <SiteHealthCardView audit={audit} />
      </MemoryRouter>
    )
    expect(screen.getByText('64')).toBeTruthy()
    expect(screen.getByText(/needs work/i)).toBeTruthy()
    expect(screen.getByText(/4\s*\/\s*7/)).toBeTruthy()
  })
})

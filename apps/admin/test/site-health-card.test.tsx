import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { AuditResult, GitPort } from '@setu/core'
import { ServicesProvider, servicesFor } from '../src/data/store'
import {
  SiteHealthCard,
  SiteHealthCardView
} from '../src/screens/dashboard/SiteHealthCard'

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

describe('SiteHealthCard', () => {
  // #572: while the audit computes, the card shell paints with skeleton placeholders
  // shaped like the score — no bare "Checking…" text.
  it('renders skeleton placeholders while the audit loads (#572)', () => {
    // A never-resolving git.list keeps the audit pending for the whole test.
    const git: GitPort = {
      ...createMemoryGitPort(),
      list: () => new Promise<string[]>(() => {})
    }
    const { container } = render(
      <MemoryRouter>
        <ServicesProvider services={servicesFor(createMemoryDataPort(), git)}>
          <SiteHealthCard />
        </ServicesProvider>
      </MemoryRouter>
    )
    expect(screen.getByText('Site Health')).toBeInTheDocument()
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
  })
})

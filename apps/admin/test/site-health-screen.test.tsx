import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AuditResult } from '@setu/core'
import { SiteHealthView } from '../src/screens/SiteHealth'

const audit: AuditResult = {
  score: 60, band: 'needs-work', byCategory: [], mustHaves: { done: 3, total: 6 },
  results: [
    { id: 'foundations.description', status: 'fail', owner: 'config' },
    { id: 'foundations.canonical', status: 'fail', owner: 'platform' },
    { id: 'security.hsts', status: 'pending', owner: 'manual' },
    { id: 'foundations.title', status: 'pass', owner: 'config' },
  ],
}

describe('SiteHealthView', () => {
  it('groups failures by owner: fix-now vs roadmap vs manual', () => {
    render(<SiteHealthView audit={audit} />)
    expect(screen.getByText(/fix now/i)).toBeTruthy()
    expect(screen.getByText(/on setu.s roadmap/i)).toBeTruthy()
    expect(screen.getAllByText(/manual/i).length).toBeGreaterThan(0)
    // a config fail appears under fix-now with its rubric title
    expect(screen.getByText(/meta description/i)).toBeTruthy()
    // platform fail appears under roadmap
    expect(screen.getByText(/canonical url/i)).toBeTruthy()
  })
})

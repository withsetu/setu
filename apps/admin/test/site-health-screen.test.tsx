import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
    // a config fail appears UNDER the fix-now section (not merely on screen)
    const fixNow = screen.getByText(/fix now/i).closest('section')!
    expect(within(fixNow).getByText(/meta description/i)).toBeTruthy()
    // a platform fail appears UNDER the roadmap section — the core grouping invariant
    const roadmap = screen.getByText(/on setu.s roadmap/i).closest('section')!
    expect(within(roadmap).getByText(/canonical url/i)).toBeTruthy()
    // and the platform fail is NOT misfiled under fix-now
    expect(within(fixNow).queryByText(/canonical url/i)).toBeNull()
  })
})

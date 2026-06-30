import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
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
    render(<SiteHealthView audit={audit} toggle={() => {}} />)
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

  it('renders an attest checkbox for unverified items and calls toggle on click', () => {
    const toggle = vi.fn()
    const auditWithAttest: AuditResult = {
      score: 50, band: 'needs-work', byCategory: [], mustHaves: { done: 1, total: 2 },
      results: [
        { id: 'privacy.policy', status: 'unverified', owner: 'manual', attestable: true },
        { id: 'i18n.hreflang', status: 'na', owner: 'manual', naSource: 'auto' },
      ],
    }
    render(<SiteHealthView audit={auditWithAttest} toggle={toggle} />)
    // the unverified item shows an "I've verified this" control under "To verify"
    const verify = screen.getByText(/to verify/i).closest('section')!
    const checkbox = within(verify).getByRole('checkbox', { name: /verified/i })
    fireEvent.click(checkbox)
    expect(toggle).toHaveBeenCalledWith('item', 'privacy.policy', 'attested')
    // the auto-na item shows in a Not applicable group, greyed (no toggle)
    expect(screen.getAllByText(/not applicable/i).length).toBeGreaterThan(0)
  })
})

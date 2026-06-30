import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import type { AuditResult, HealthState } from '@setu/core'
import { SiteHealthView } from '../src/screens/SiteHealth'

const emptyHealth: HealthState = { items: {}, sections: {} }

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
    render(<SiteHealthView audit={audit} toggle={() => {}} health={emptyHealth} />)
    expect(screen.getByText(/fix now/i)).toBeTruthy()
    expect(screen.getByText(/on setu.s roadmap/i)).toBeTruthy()
    expect(screen.getByText(/to verify/i)).toBeTruthy()
    // a config fail appears UNDER the fix-now section (not merely on screen)
    const fixNow = screen.getByText(/fix now/i).closest('section')!
    // title is '<meta name="description">' — match on the "description" keyword
    expect(within(fixNow).getByText(/meta name="description"/i)).toBeTruthy()
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
    render(<SiteHealthView audit={auditWithAttest} toggle={toggle} health={emptyHealth} />)
    // the unverified item shows an "I've verified this" control under "To verify"
    const verify = screen.getByText(/to verify/i).closest('section')!
    const checkbox = within(verify).getByRole('checkbox', { name: /verified/i })
    fireEvent.click(checkbox)
    expect(toggle).toHaveBeenCalledWith('item', 'privacy.policy', 'attested')
    // "Not applicable" section heading is present
    expect(screen.getByRole('heading', { name: /not applicable/i })).toBeTruthy()
  })

  it('renders section applicability panel and calls toggle when a category is unchecked', () => {
    const toggle = vi.fn()
    // Start with 'seo' already skipped
    const healthWithSkip: HealthState = {
      items: {},
      sections: { seo: { state: 'na', at: '2026-06-30T00:00:00Z', by: 'test' } },
    }
    render(<SiteHealthView audit={audit} toggle={toggle} health={healthWithSkip} />)

    // Panel heading is present
    expect(screen.getByText(/sections that apply to your site/i)).toBeTruthy()

    // SEO checkbox should be unchecked (skipped)
    const seoCheckbox = screen.getByRole('checkbox', { name: /seo/i })
    expect((seoCheckbox as HTMLInputElement).getAttribute('data-state')).toBe('unchecked')

    // Foundations checkbox should be checked (not skipped)
    const foundationsCheckbox = screen.getByRole('checkbox', { name: /foundations/i })
    expect((foundationsCheckbox as HTMLInputElement).getAttribute('data-state')).toBe('checked')

    // Clicking the SEO checkbox (re-enabling it) calls toggle('section', 'seo', null)
    fireEvent.click(seoCheckbox)
    expect(toggle).toHaveBeenCalledWith('section', 'seo', null)

    // Clicking Foundations (disabling it) calls toggle('section', 'foundations', 'na')
    fireEvent.click(foundationsCheckbox)
    expect(toggle).toHaveBeenCalledWith('section', 'foundations', 'na')
  })
})

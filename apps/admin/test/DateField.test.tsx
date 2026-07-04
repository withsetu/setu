import { describe, expect, it, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DateField } from '../src/editor/DateField'

// react-day-picker / Radix Popover call scrollIntoView when opened — stub for jsdom.
beforeAll(() => {
  if (
    typeof window !== 'undefined' &&
    !window.HTMLElement.prototype.scrollIntoView
  ) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
})

describe('DateField', () => {
  it('shows a "Set date" trigger when there is no date', () => {
    render(<DateField value={undefined} onChange={vi.fn()} editable />)
    expect(
      screen.getByRole('button', { name: /set date/i })
    ).toBeInTheDocument()
  })

  it('shows no clear control when there is no date', () => {
    render(<DateField value={undefined} onChange={vi.fn()} editable />)
    expect(screen.queryByRole('button', { name: /clear date/i })).toBeNull()
  })

  it('displays a stored date-only string as a human date', () => {
    render(<DateField value="2026-07-04" onChange={vi.fn()} editable />)
    expect(screen.getByText('Jul 4, 2026')).toBeInTheDocument()
  })

  it('displays an existing full-ISO date on its UTC calendar day (no off-by-one)', () => {
    // The resolver reads date tokens in UTC; the field must show the same day it
    // will appear in the URL, not the local-timezone-shifted day.
    render(
      <DateField value="2026-06-20T00:00:00.000Z" onChange={vi.fn()} editable />
    )
    expect(screen.getByText('Jun 20, 2026')).toBeInTheDocument()
  })

  it('clears the date via the clear control', () => {
    const onChange = vi.fn()
    render(<DateField value="2026-07-04" onChange={onChange} editable />)
    fireEvent.click(screen.getByRole('button', { name: /clear date/i }))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('disables the trigger and clear control when not editable', () => {
    render(<DateField value="2026-07-04" onChange={vi.fn()} editable={false} />)
    expect(screen.getByRole('button', { name: /jul 4, 2026/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /clear date/i })).toBeDisabled()
  })
})

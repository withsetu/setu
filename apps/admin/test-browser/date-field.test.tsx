import { describe, it, expect, afterEach, vi } from 'vitest'
import { useState } from 'react'
import { render, cleanup } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { DateField } from '../src/editor/DateField'

// ---------------------------------------------------------------------------------
// DateField (#365): the calendar lives in a real Radix Popover portal + react-day-picker.
// jsdom's fireEvent never opens the portal or lays out the grid (see DateField's jsdom
// suite, which asserts the closed-state display and the clear control only). This drives
// the REAL round-trip: open the popover, click a day, assert the frontmatter string.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

describe('DateField (real browser)', () => {
  it('opens the calendar and round-trips a picked day to a YYYY-MM-DD string', async () => {
    const onChange = vi.fn()
    // Controlled, mirroring MetaPanel: onChange's value flows back as the next prop.
    function Controlled() {
      const [v, setV] = useState<string | undefined>('2026-07-10')
      return (
        <DateField
          value={v}
          onChange={(n) => {
            onChange(n)
            setV(n)
          }}
          editable
        />
      )
    }
    render(<Controlled />)

    // The trigger shows the current date; open the real popover.
    const trigger = page.getByRole('button', { name: /jul 10, 2026/i })
    await trigger.click()

    // The calendar grid is now in a real portal — pick a different day in the month.
    // Day buttons carry a full-date aria-label, so target the day's text node ("20"
    // is unique within the July grid; "2026" is a single "Jul 10, 2026" text node).
    const day20 = page.getByText('20', { exact: true })
    await expect.element(day20).toBeInTheDocument()
    await day20.click()

    expect(onChange).toHaveBeenCalledWith('2026-07-20')
    // The trigger reflects the new pick after the controlled round-trip.
    await expect
      .element(page.getByRole('button', { name: /jul 20, 2026/i }))
      .toBeInTheDocument()
  })

  it('clears back to date-less via the clear control', async () => {
    const onChange = vi.fn()
    function Controlled() {
      const [v, setV] = useState<string | undefined>('2026-07-10')
      return (
        <DateField
          value={v}
          onChange={(n) => {
            onChange(n)
            setV(n)
          }}
          editable
        />
      )
    }
    render(<Controlled />)

    await page.getByRole('button', { name: 'Clear date' }).click()
    expect(onChange).toHaveBeenCalledWith(undefined)
    await expect
      .element(page.getByRole('button', { name: /set date/i }))
      .toBeInTheDocument()
  })
})

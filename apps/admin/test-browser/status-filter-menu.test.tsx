import { describe, it, expect, afterEach, vi } from 'vitest'
import { useState } from 'react'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'

// TagFilter needs the Index/Services providers; the toolbar's status control is
// what's under test, so stub it exactly as the jsdom test does.
vi.mock('../src/screens/TagFilter', () => ({
  TagFilter: () => <input aria-label="Filter by tag" readOnly value="" />
}))

import { ListToolbar } from '../src/screens/content-list/ListToolbar'
import { STATUS_FILTER_MENU } from '../src/lib/status-filter-vocab'

afterEach(cleanup)

const base = {
  title: 'Posts',
  search: '',
  onSearch: () => {},
  category: '',
  onCategory: () => {},
  catRows: [],
  tag: '',
  onTag: () => {},
  featured: '',
  onFeatured: () => {},
  seo: '',
  onSeo: () => {},
  hasFilters: false,
  onClear: () => {},
  columnsMenu: <button>Columns</button>
}

/** #598: the status menu is the surface the owner called "too many options", so
 *  the shortened list is verified through a REAL Radix Select portal in chromium
 *  — jsdom needs a scrollIntoView stub to open one at all, and never lays the
 *  two-line options out. Convention follows control-interactions.test.tsx. */
function Harness({ initial = '' }: { initial?: string }) {
  const [status, setStatus] = useState(initial)
  return <ListToolbar {...base} status={status} onStatus={setStatus} />
}

describe('status filter menu (real browser)', () => {
  it('opens a four-option menu and picks a status round-trip', async () => {
    render(<Harness />)
    const trigger = page.getByLabelText('Filter by status')
    await expect.element(trigger).toHaveTextContent('All status')
    await userEvent.click(trigger)

    await expect.poll(() => page.getByRole('option').elements().length).toBe(4)

    // Every hint the dashboard tiles show is legible here too — one vocabulary.
    for (const e of STATUS_FILTER_MENU) {
      await expect.element(page.getByText(e.hint)).toBeVisible()
    }

    await userEvent.click(page.getByRole('option', { name: /Staged/ }))
    await expect
      .element(page.getByLabelText('Filter by status'))
      .toHaveTextContent('Staged')
  })

  it('surfaces an off-menu URL status as its own selected option', async () => {
    render(<Harness initial="published" />)
    const trigger = page.getByLabelText('Filter by status')
    await expect.element(trigger).toHaveTextContent('Published')
    await userEvent.click(trigger)
    await expect.poll(() => page.getByRole('option').elements().length).toBe(5)
    // `exact` matters: the Drafts option's accessible name is "DraftsNot
    // published", which substring-matches "Published".
    await expect
      .element(page.getByRole('option', { name: 'Published', exact: true }))
      .toHaveAttribute('aria-selected', 'true')
  })
})

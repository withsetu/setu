import { describe, it, expect } from 'vitest'
import { isIndexStatusFilter, INDEX_STATUS_FILTERS } from '@setu/core'
import {
  STATUS_FILTER_MENU,
  statusFilterLabel
} from '../src/lib/status-filter-vocab'

/** #598 UAT: the menu had seven options and the dashboard tiles used a second,
 *  different set of words for the same three ideas ("On the site" vs "Live /
 *  Published / Not published"). You clicked one wording and landed on another.
 *  One list now feeds both surfaces, so they cannot drift again. */
describe('status filter vocabulary', () => {
  it('offers exactly three named choices, in Live → Staged → Drafts order', () => {
    expect(STATUS_FILTER_MENU.map((e) => e.value)).toEqual([
      'live',
      'staged',
      'not-published'
    ])
  })

  /** The property that separates these is INTENT (do you want this public?),
   *  not location: a staged entry is also "not on the site", so that phrase
   *  could never distinguish Staged from Drafts. */
  it('pairs each choice with the hint the dashboard tile shows', () => {
    expect(STATUS_FILTER_MENU).toEqual([
      { value: 'live', label: 'Live', hint: 'On the site' },
      { value: 'staged', label: 'Staged', hint: 'Pending deploy' },
      { value: 'not-published', label: 'Drafts', hint: 'Not published' }
    ])
  })

  it('never labels anything "Not on the site" — untrue of Staged too', () => {
    for (const e of STATUS_FILTER_MENU) {
      expect(e.hint).not.toMatch(/not on the site/i)
    }
  })

  /** Off-menu values stay valid in `?status=` (deep links, the #579 port work).
   *  The control must name them honestly rather than reading "All status". */
  it('labels every valid filter value, including the off-menu ones', () => {
    for (const v of INDEX_STATUS_FILTERS) {
      expect(statusFilterLabel(v)).toBeTruthy()
      expect(statusFilterLabel(v)).not.toBe(v)
    }
    expect(statusFilterLabel('published')).toBe('Published')
    expect(statusFilterLabel('draft')).toBe('Draft')
    expect(statusFilterLabel('unpublished')).toBe('Unpublished')
  })

  it('every menu value is a filter the index actually accepts', () => {
    for (const e of STATUS_FILTER_MENU) {
      expect(isIndexStatusFilter(e.value)).toBe(true)
    }
  })
})

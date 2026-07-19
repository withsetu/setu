import type { IndexStatusFilter } from '@setu/core'

export interface StatusFilterChoice {
  value: IndexStatusFilter
  /** The word on the tile AND on the menu option — one string, two surfaces. */
  label: string
  /** The muted second line, on the tile AND under the menu option. */
  hint: string
}

/** The status vocabulary the admin puts in front of a user, and the ONLY place
 *  those words live — the At-a-glance tiles and the content list's status filter
 *  both render from this list.
 *
 *  #598 UAT found the two surfaces had drifted into separate wordings for one
 *  concept: the tiles said "On the site / Pending deploy / Not on the site", the
 *  filter they deep-link to said "Live / Staged / Draft / Unpublished /
 *  Published (staged + live) / Not published (draft + unpublished)". Seven
 *  options, two vocabularies — you clicked one phrase and landed on another.
 *
 *  Three choices, cut along INTENT (do you want this public?) rather than
 *  location. Location cannot do the job: a staged entry is also not on the site,
 *  so "Not on the site" and "Not live" are both false-by-omission labels for the
 *  Drafts set. Live and Staged are both *intended public* and differ only by
 *  whether a deploy has happened; Drafts is the complement — draft (never
 *  published) plus unpublished (taken down), which is core's `not-published`
 *  union (#611).
 *
 *  The exact states `draft` and `unpublished`, and the `published` union (#579),
 *  remain valid `?status=` values and valid `IndexQuery.status` — see
 *  `statusFilterLabel`. Only this MENU is short. */
export const STATUS_FILTER_MENU: readonly StatusFilterChoice[] = [
  { value: 'live', label: 'Live', hint: 'On the site' },
  { value: 'staged', label: 'Staged', hint: 'Pending deploy' },
  { value: 'not-published', label: 'Drafts', hint: 'Not published' }
] as const

/** Filter values that are still accepted from a URL but are not offered as menu
 *  entries — `published` (#579) and the two exact states the Drafts union covers.
 *  Deep links and the index port contract depend on them continuing to work. */
const OFF_MENU_LABELS: Record<string, string> = {
  published: 'Published',
  draft: 'Draft',
  unpublished: 'Unpublished'
}

/** Human label for any valid filter value, on-menu or not. A `?status=draft`
 *  link must show "Draft" in the control, never fall through to "All status" —
 *  a filtered list under an unfiltered-looking control is the bug #579 fixed. */
export const statusFilterLabel = (value: string): string =>
  STATUS_FILTER_MENU.find((e) => e.value === value)?.label ??
  OFF_MENU_LABELS[value] ??
  value

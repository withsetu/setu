/**
 * Windowed pagination for archive pagers (#558).
 *
 * Produces the item sequence for a standard windowed pager: always page 1 and
 * the last page, the current page ±2, and `'gap'` markers (rendered as “…”)
 * where pages are elided. A gap that would hide only a single page collapses
 * into that page number, so `…` always stands for at least two pages
 * (e.g. current=5 → `1 2 3 4 5 6 7 … 150`, never `1 … 3 4 5 6 7 … 150`).
 * Page counts of 7 or fewer render every number.
 */
export type PaginationItem = number | 'gap'

const RENDER_ALL_MAX = 7
const WINDOW_RADIUS = 2

export function paginationWindow(
  current: number,
  last: number
): PaginationItem[] {
  if (last <= RENDER_ALL_MAX) {
    return Array.from({ length: last }, (_, i) => i + 1)
  }
  const page = Math.min(Math.max(current, 1), last)
  let start = Math.max(2, page - WINDOW_RADIUS)
  let end = Math.min(last - 1, page + WINDOW_RADIUS)
  // Collapse a gap that would hide exactly one page into the page itself.
  if (start === 3) start = 2
  if (end === last - 2) end = last - 1

  const items: PaginationItem[] = [1]
  if (start > 2) items.push('gap')
  for (let n = start; n <= end; n++) items.push(n)
  if (end < last - 1) items.push('gap')
  items.push(last)
  return items
}

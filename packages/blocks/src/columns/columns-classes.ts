/** Shared class/style derivation for the columns block — single source of truth for
 *  the site renderer (Columns.astro) AND the editor canvas (admin Columns extension),
 *  so the in-editor visual can never drift from the published one. */

const GAPS = new Set(['none', 'sm', 'md', 'lg'])

/** `"33-67"` → `"33fr 67fr"`. Only accepts dash-separated positive integers (2–4
 *  segments); anything else falls back to an even two-column split so hand-authored
 *  or legacy values degrade gracefully instead of breaking the grid. */
export function columnsTemplate(layout: unknown): string {
  if (typeof layout === 'string' && /^\d+(-\d+){1,3}$/.test(layout)) {
    return layout
      .split('-')
      .map((seg) => `${seg}fr`)
      .join(' ')
  }
  return '1fr 1fr'
}

export interface ColumnsRenderAttrs {
  className: string
  /** Inline style string setting the block-local grid template. */
  style: string
}

/** Root class list + inline style for a columns block instance. */
export function columnsRenderAttrs(attrs: {
  layout?: unknown
  gap?: unknown
  stackOnMobile?: unknown
}): ColumnsRenderAttrs {
  const gap =
    typeof attrs.gap === 'string' && GAPS.has(attrs.gap) ? attrs.gap : 'md'
  const stack = attrs.stackOnMobile !== false
  const className = ['blk-columns', `gap-${gap}`, stack ? 'stack' : '']
    .filter(Boolean)
    .join(' ')
  return {
    className,
    style: `--blk-columns-template: ${columnsTemplate(attrs.layout)}`
  }
}

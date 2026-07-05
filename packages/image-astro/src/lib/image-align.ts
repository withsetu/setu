// Per-alignment browser `sizes` hint for a {% image %} figure, so the srcset (#4b) picks the
// right variant. Pure + build-time only. Anchored to the default theme's content/page widths
// (packages/theme-default/theme.css: --measure-post 38rem ≈ 608px, --measure-page 64rem ≈ 1024px);
// theme-reactive sizes is a later refinement.
export type ImageAlign = 'none' | 'left' | 'right' | 'wide' | 'full'

const CONTENT_PX = 608 // 38rem — the prose content column (--measure-post)
const PAGE_PX = 1024 // 64rem — the page width (--measure-page)

/** `sizes` hint for the given alignment. Unknown/empty align is treated as 'none'; never throws.
 *  `(string & {})` keeps the ImageAlign literals visible in autocomplete without the union
 *  collapsing to plain `string` (no-redundant-type-constituents). */
export function sizesForAlign(
  align: ImageAlign | (string & {}) | undefined
): string {
  switch (align) {
    case 'full':
      return '100vw'
    case 'wide':
      return `min(100vw, ${PAGE_PX}px)`
    case 'left':
    case 'right':
      return `(max-width: ${CONTENT_PX}px) 100vw, ${Math.round(CONTENT_PX / 2)}px`
    case 'none':
    default:
      return `min(100vw, ${CONTENT_PX}px)`
  }
}

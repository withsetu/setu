export type SectionBackground = 'none' | 'soft' | 'accent' | 'inverted'
export type SectionPadding = 'none' | 'sm' | 'md' | 'lg'
export type SectionWidth = 'none' | 'wide' | 'full'

// Defense-in-depth allowlists: Markdoc validation is non-blocking, so hand-authored
// attrs reach the renderer as-is — every value is clamped to its known set before it
// is interpolated into a class string (unknown → the prop's default, never pass-through).
const BACKGROUNDS: ReadonlySet<string> = new Set([
  'none',
  'soft',
  'accent',
  'inverted'
])
const PADDINGS: ReadonlySet<string> = new Set(['none', 'sm', 'md', 'lg'])
const WIDTHS: ReadonlySet<string> = new Set(['none', 'wide', 'full'])

const clamp = (
  value: string,
  allowed: ReadonlySet<string>,
  fallback: string
) => (allowed.has(value) ? value : fallback)

/** Class string for a section band. Shared by the React core (editor canvas) and
 *  Section.astro (site) so the two renders can never drift. Defaults ('none'
 *  background/width) add no modifier class — the canonical markup stays clean.
 *  'normal' is tolerated as a legacy alias for the 'none' width sentinel. */
export function sectionClasses(
  background: string = 'none',
  padding: string = 'md',
  width: string = 'none',
  hasMedia = false
): string {
  const bg = clamp(background, BACKGROUNDS, 'none')
  const pad = clamp(padding, PADDINGS, 'md')
  const w = clamp(width === 'normal' ? 'none' : width, WIDTHS, 'none')
  let cls = `blk-section pad-${pad}`
  if (bg !== 'none') cls += ` bg-${bg}`
  if (w !== 'none') cls += ` w-${w}`
  if (hasMedia) cls += ' has-media'
  return cls
}

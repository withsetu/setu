export type SectionBackground = 'none' | 'soft' | 'accent' | 'inverted'
export type SectionPadding = 'none' | 'sm' | 'md' | 'lg'
export type SectionWidth = 'normal' | 'wide' | 'full'

/** Class string for a section band. Shared by the React core (editor canvas) and
 *  Section.astro (site) so the two renders can never drift. Defaults ('none' background,
 *  'normal' width) add no modifier class — the canonical markup stays clean. */
export function sectionClasses(
  background: string = 'none',
  padding: string = 'md',
  width: string = 'normal',
  hasMedia = false
): string {
  let cls = `blk-section pad-${padding}`
  if (background && background !== 'none') cls += ` bg-${background}`
  if (width && width !== 'normal') cls += ` w-${width}`
  if (hasMedia) cls += ' has-media'
  return cls
}

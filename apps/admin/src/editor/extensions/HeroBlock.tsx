import { Hero } from '@setu/blocks'
import type { HeroProps } from '@setu/blocks'
import { resolveMediaSrc } from '../media-src'
import { attrString, attrStringOrUndefined } from '../attr-string'
import { createAtomBlock, atomCoreView } from './atom-block'

/** Map the hero node's raw mdAttrs onto Hero's props for the read-only canvas view:
 *  `image` is a `/media/…` src resolved against the canvas media origin; every other
 *  field is passed through, with the headline falling back to a visible placeholder so
 *  a fresh hero never renders an empty heading. */
function heroProps(md: Record<string, unknown>, apiBase: string): HeroProps {
  const imageAttr = attrStringOrUndefined(md['image'])
  return {
    headline: attrString(md['headline'], 'Hero headline'),
    subhead: attrStringOrUndefined(md['subhead']),
    image: imageAttr
      ? resolveMediaSrc(imageAttr, apiBase || undefined)
      : undefined,
    ctaLabel: attrStringOrUndefined(md['ctaLabel']),
    ctaHref: attrStringOrUndefined(md['ctaHref']),
    layout: attrStringOrUndefined(md['layout']) as HeroProps['layout'],
    textPosition: attrStringOrUndefined(md['textPosition']),
    textAlign: attrStringOrUndefined(md['textAlign']),
    overlayColor: attrStringOrUndefined(md['overlayColor']),
    textColor: attrStringOrUndefined(md['textColor']),
    width: attrStringOrUndefined(md['width'])
  }
}

/** The `{% hero %}` block — atom (props-only, no body); props edited in the inspector rail.
 *  Mirrors ImageBlock/ContactBlock: mdAttrs JSON-only, kept out of the DOM, round-tripped
 *  by the core converter (to-tiptap maps hero→heroBlock, to-markdoc emits self-closing).
 *  Node.create boilerplate + the shared canvas view come from the atom-block factory (#562). */
export const HeroBlock = createAtomBlock({
  name: 'heroBlock',
  dataAttr: 'data-setu-hero-block',
  view: atomCoreView('hero', Hero, heroProps)
})

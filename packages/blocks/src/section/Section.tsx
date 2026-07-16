import './section.css'
import type { ReactNode } from 'react'
import { sectionClasses } from './section-classes'

export interface SectionProps {
  /** Background preset: none | soft | accent | inverted (token-mapped, no free color). */
  background?: string
  /** Optional background image (cover-fit behind the content, with a legibility scrim). */
  image?: string
  /** Vertical/horizontal padding scale: none | sm | md | lg. */
  padding?: string
  /** Band width intent: normal | wide | full (breakout math lives in the theme). */
  width?: string
  /** The grouped blocks. */
  children: ReactNode
}

/** The section visual core — a Group/Cover-style band wrapping arbitrary blocks.
 *  Rendered live in the editor canvas (via the generic setuBlock node, body editable
 *  in place) and mirrored by Section.astro on the site, sharing section.css. The
 *  media layer is contentEditable=false so the caret can never enter it in-canvas. */
export function Section({
  background = 'none',
  image,
  padding = 'md',
  width = 'normal',
  children
}: SectionProps) {
  return (
    <section
      className={sectionClasses(background, padding, width, Boolean(image))}
    >
      {image ? (
        <div
          className="blk-section-media"
          contentEditable={false}
          aria-hidden="true"
        >
          <img src={image} alt="" />
        </div>
      ) : null}
      <div className="blk-section-inner">{children}</div>
    </section>
  )
}

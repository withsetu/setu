import './hero.css'
import { heroClasses, type HeroLayout } from './hero-classes'
import { isSafeColor } from '../sanitize'

export interface HeroProps {
  headline: string
  subhead?: string
  image?: string
  imageAlt?: string
  ctaLabel?: string
  ctaHref?: string
  layout?: HeroLayout
  textPosition?: string
  textAlign?: string
  overlayColor?: string
  textColor?: string
  width?: string
}

/** The hero visual core. Rendered read-only in the editor canvas (props from the node's
 *  mdAttrs); the site mirrors this exact class structure in Hero.astro, sharing hero.css. */
// `ctaHref` stays in HeroProps for parity with Hero.astro (which renders the real
// <a href>), but the canvas core deliberately renders the CTA as a non-navigating
// <span> — a live link inside the editor would navigate away mid-edit.
export function Hero({
  headline,
  subhead,
  image,
  imageAlt,
  ctaLabel,
  layout = 'centered',
  textPosition = 'center',
  textAlign,
  overlayColor,
  textColor,
  width
}: HeroProps) {
  // Mirror Hero.astro's #857 color validation and #862 a11y handling so the canvas and
  // the site never disagree. isSafeColor drops an injection payload; the empty <h2> and
  // forced-decorative alt are skipped the same way.
  const style: Record<string, string> = {}
  if (layout === 'background')
    style['--blk-hero-scrim'] = isSafeColor(overlayColor)
      ? overlayColor
      : 'rgba(15,17,26,0.55)'
  if (isSafeColor(textColor)) style['--blk-hero-text-color'] = textColor
  const altText = layout === 'background' ? '' : (imageAlt ?? headline ?? '')
  const hasHeadline = typeof headline === 'string' && headline.trim() !== ''
  return (
    <section
      className={heroClasses(layout, textPosition, width, textAlign)}
      style={style}
    >
      {image ? (
        <div className="blk-hero-media">
          <img src={image} alt={altText} />
        </div>
      ) : null}
      <div className="blk-hero-text">
        {hasHeadline ? <h2 className="blk-hero-headline">{headline}</h2> : null}
        {subhead ? <p className="blk-hero-subhead">{subhead}</p> : null}
        {ctaLabel ? <span className="blk-hero-cta">{ctaLabel}</span> : null}
      </div>
    </section>
  )
}

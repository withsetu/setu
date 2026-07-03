import './hero.css'
import { heroClasses, type HeroLayout } from './hero-classes'

export interface HeroProps {
  headline: string
  subhead?: string
  image?: string
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
export function Hero({
  headline,
  subhead,
  image,
  ctaLabel,
  ctaHref,
  layout = 'centered',
  textPosition = 'center',
  textAlign,
  overlayColor,
  textColor,
  width
}: HeroProps) {
  const style: Record<string, string> = {}
  if (layout === 'background')
    style['--blk-hero-scrim'] = overlayColor ?? 'rgba(15,17,26,0.55)'
  if (textColor) style['--blk-hero-text-color'] = textColor
  return (
    <section
      className={heroClasses(layout, textPosition, width, textAlign)}
      style={style}
    >
      {image ? (
        <div className="blk-hero-media">
          <img src={image} alt="" />
        </div>
      ) : null}
      <div className="blk-hero-text">
        <h2 className="blk-hero-headline">{headline}</h2>
        {subhead ? <p className="blk-hero-subhead">{subhead}</p> : null}
        {ctaLabel ? <span className="blk-hero-cta">{ctaLabel}</span> : null}
      </div>
    </section>
  )
}

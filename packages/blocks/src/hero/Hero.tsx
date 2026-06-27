import './hero.css'

export interface HeroProps {
  headline: string
  subhead?: string
  image?: string
  ctaLabel?: string
  ctaHref?: string
  variant?: 'left' | 'center'
}

/** The hero visual core. Rendered read-only in the editor canvas (props from the node's
 *  mdAttrs); the site mirrors this exact class structure in Hero.astro, sharing hero.css. */
export function Hero({ headline, subhead, image, ctaLabel, ctaHref, variant = 'center' }: HeroProps) {
  return (
    <section className={`blk-hero variant-${variant}`}>
      {image ? <img className="blk-hero-img" src={image} alt="" /> : null}
      <div className="blk-hero-body">
        <h2 className="blk-hero-headline">{headline}</h2>
        {subhead ? <p className="blk-hero-subhead">{subhead}</p> : null}
        {ctaLabel && ctaHref ? <span className="blk-hero-cta">{ctaLabel}</span> : null}
      </div>
    </section>
  )
}

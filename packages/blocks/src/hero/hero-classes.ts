export type HeroLayout = 'centered' | 'split-left' | 'split-right' | 'background'

export function heroClasses(layout: HeroLayout, textPosition: string, width?: string): string {
  const base = `blk-hero layout-${layout} pos-${textPosition}`
  return width && width !== 'none' ? `${base} w-${width}` : base
}

export function sizesForLayout(layout: HeroLayout): string {
  if (layout === 'split-left' || layout === 'split-right') return '(min-width: 768px) 50vw, 100vw'
  return '100vw'
}

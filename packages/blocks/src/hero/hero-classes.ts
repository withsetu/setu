export type HeroLayout =
  'centered' | 'split-left' | 'split-right' | 'background'

export function heroClasses(
  layout: HeroLayout,
  textPosition: string,
  width?: string,
  textAlign?: string
): string {
  let cls = `blk-hero layout-${layout} pos-${textPosition}`
  if (width && width !== 'none') cls += ` w-${width}`
  if (textAlign) cls += ` ta-${textAlign}`
  return cls
}

export function sizesForLayout(layout: HeroLayout): string {
  if (layout === 'split-left' || layout === 'split-right')
    return '(min-width: 768px) 50vw, 100vw'
  return '100vw'
}

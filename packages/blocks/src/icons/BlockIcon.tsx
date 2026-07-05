import { BLOCK_ICON_SVGS } from './svgs'
import type { BlockIconName } from './svgs'

export function BlockIcon({
  name,
  size = 18,
  stroke = 1.75,
  className = ''
}: {
  name: BlockIconName
  size?: number
  stroke?: number
  className?: string
}) {
  const d = BLOCK_ICON_SVGS[name]
  if (!d) return null
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block' }}
      dangerouslySetInnerHTML={{ __html: d }}
      aria-hidden="true"
    />
  )
}

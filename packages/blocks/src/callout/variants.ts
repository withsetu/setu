import { isBlockIconName } from '../icons/svgs'
import type { BlockIconName } from '../icons/svgs'

export interface CalloutVariant {
  type: string
  label: string
  /** CSS tone suffix: accent | green | amber | red | slate | neutral. */
  tone: string
  /** Default icon for the type (the default-theme mapping). */
  icon: BlockIconName
}

// VARIANT_MAP is the renderer's source of truth for callout variants. Each
// key becomes one selectable type in the editor palette. Unifying this with
// each block's authored block.ts `editor.variants` field is future work
// (Slice B).
const VARIANT_MAP: Record<
  string,
  { label: string; tone: string; icon: BlockIconName }
> = {
  info: { label: 'Info', tone: 'accent', icon: 'info' },
  note: { label: 'Note', tone: 'neutral', icon: 'sparkle' },
  success: { label: 'Success', tone: 'green', icon: 'check' },
  warning: { label: 'Warning', tone: 'amber', icon: 'alert' },
  danger: { label: 'Danger', tone: 'red', icon: 'alert' },
  neutral: { label: 'Neutral', tone: 'neutral', icon: 'sparkle' }
}

const NEUTRAL = {
  label: 'Neutral',
  tone: 'neutral',
  icon: 'sparkle' as BlockIconName
}

/** Icons offered in the callout icon-override picker (curated). */
export const CALLOUT_ICONS: BlockIconName[] = [
  'info',
  'check',
  'alert',
  'sparkle',
  'zap',
  'pin',
  'lock',
  'settings'
]

export function variantFor(type: string): CalloutVariant {
  const v = VARIANT_MAP[type] ?? NEUTRAL
  return { type, label: v.label, tone: v.tone, icon: v.icon }
}

export function calloutVariants(): CalloutVariant[] {
  return Object.keys(VARIANT_MAP).map(variantFor)
}

/** The callout's icon: an author's override when it names a known icon, else the tone's
 *  default (#1247). One rule for the editor canvas (apps/admin Callout.tsx) and the site
 *  renderer (blocks/callout/callout.astro), so the two can't show different icons.
 *  Pinned by packages/blocks/test/variants.test.ts and apps/site/test/render.test.ts. */
export function calloutIcon(type: string, override: unknown): BlockIconName {
  return typeof override === 'string' && isBlockIconName(override)
    ? override
    : variantFor(type).icon
}

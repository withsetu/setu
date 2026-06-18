import type { BlockIconName } from '../icons/svgs'
import { defaultConfig, resolveConfig } from '@saytu/core'

export interface CalloutVariant {
  type: string
  label: string
  /** CSS tone suffix: accent | green | amber | red | slate | neutral. */
  tone: string
  /** Default icon for the type (the default-theme mapping). */
  icon: BlockIconName
}

const VARIANT_MAP: Record<string, { label: string; tone: string; icon: BlockIconName }> = {
  info: { label: 'Info', tone: 'accent', icon: 'info' },
  note: { label: 'Note', tone: 'neutral', icon: 'sparkle' },
  success: { label: 'Success', tone: 'green', icon: 'check' },
  warning: { label: 'Warning', tone: 'amber', icon: 'alert' },
  danger: { label: 'Danger', tone: 'red', icon: 'alert' },
  neutral: { label: 'Neutral', tone: 'neutral', icon: 'sparkle' },
}

const NEUTRAL = { label: 'Neutral', tone: 'neutral', icon: 'sparkle' as BlockIconName }

/** Icons offered in the callout icon-override picker (curated). */
export const CALLOUT_ICONS: BlockIconName[] = ['info', 'check', 'alert', 'sparkle', 'zap', 'pin', 'lock', 'settings']

function configVariantTypes(): string[] {
  const callout = resolveConfig(defaultConfig).blocksByTag.get('callout')
  const variants = callout?.editor?.variants
  return Array.isArray(variants) && variants.length ? variants : Object.keys(VARIANT_MAP)
}

export function variantFor(type: string): CalloutVariant {
  const v = VARIANT_MAP[type] ?? NEUTRAL
  return { type, label: v.label, tone: v.tone, icon: v.icon }
}

export function calloutVariants(): CalloutVariant[] {
  return configVariantTypes().map(variantFor)
}

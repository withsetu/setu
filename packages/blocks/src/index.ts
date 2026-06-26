export { BlockIcon } from './icons/BlockIcon'
export { isBlockIconName, BLOCK_ICON_SVGS } from './icons/svgs'
export type { BlockIconName } from './icons/svgs'
export { variantFor, calloutVariants, CALLOUT_ICONS } from './callout/variants'
export type { CalloutVariant } from './callout/variants'
export { Callout } from './callout/Callout'

import type { ComponentType } from 'react'
import { Notice } from './notice/Notice'
export { Notice }
export type { NoticeProps } from './notice/Notice'

import { Hero } from './hero/Hero'
export { Hero }
export type { HeroProps } from './hero/Hero'

/** Block tag -> its React visual core, for the editor's in-canvas rendering. Excludes
 *  callout (which keeps its own bespoke editor node view). */
export const blockCores: Record<string, ComponentType<any>> = { notice: Notice, hero: Hero }

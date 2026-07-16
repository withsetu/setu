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

import { Gallery } from './gallery/Gallery'
export { Gallery }
export type { GalleryProps } from './gallery/Gallery'
export {
  galleryClasses,
  galleryImagesOf,
  clampColumns,
  sizesForColumns
} from './gallery/gallery-classes'
export type {
  GalleryImage,
  GalleryGap,
  GalleryLayout
} from './gallery/gallery-classes'
export { safeMediaHref } from './safe-media-href'

/** A block's React visual core. The registry is heterogeneous by design (NoticeProps,
 *  HeroProps, …) and dispatched dynamically by tag; each block's props are validated by
 *  its own Zod contract at the Markdoc boundary, not here. `any` is the deliberate
 *  escape hatch: `ComponentType<unknown>` would reject spreading the (necessarily
 *  untyped) mdAttrs bag onto the component. Single targeted disable — every consumer
 *  uses this alias instead of re-spelling ComponentType<any>. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BlockCore = ComponentType<any>

/** Block tag -> its React visual core, for the editor's in-canvas rendering. Excludes
 *  callout (which keeps its own bespoke editor node view). */
export const blockCores: Record<string, BlockCore> = {
  notice: Notice,
  hero: Hero,
  gallery: Gallery
}

export { BLOCK_TOKENS, TOKENS_BY_AXIS } from './tokens'
export type { BlockStyleAxis, BlockToken } from './tokens'

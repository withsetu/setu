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
import { Video } from './video/Video'
export { Video }
export type { VideoProps } from './video/Video'
export { videoPlaybackAttrs, videoClasses } from './video/video-attrs'
export type {
  VideoPlaybackAttrs,
  VideoPlaybackInput
} from './video/video-attrs'

import { Section } from './section/Section'
export { Section }
export type { SectionProps } from './section/Section'
export { sectionClasses } from './section/section-classes'

/** A block's React visual core. The registry is heterogeneous by design (NoticeProps,
 *  HeroProps, …) and dispatched dynamically by tag; each block's props are validated by
 *  its own Zod contract at the Markdoc boundary, not here. `any` is the deliberate
 *  escape hatch: `ComponentType<unknown>` would reject spreading the (necessarily
 *  untyped) mdAttrs bag onto the component. Single targeted disable — every consumer
 *  uses this alias instead of re-spelling ComponentType<any>. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BlockCore = ComponentType<any>

/** Block tag -> its React visual core, for the editor's generic in-canvas rendering
 *  (`createSetuBlock`). Excludes callout (its own bespoke node view) and the atom blocks
 *  hero/gallery/video: the converters route those tags to dedicated atom nodes
 *  (heroBlock/galleryBlock/videoBlock), so the generic setuBlock path never resolves
 *  them — their cores are consumed directly by the atom-block factory instead (#562). */
export const blockCores: Record<string, BlockCore> = {
  notice: Notice,
  section: Section
}

export { columnsRenderAttrs, columnsTemplate } from './columns/columns-classes'
export type { ColumnsRenderAttrs } from './columns/columns-classes'

export { BLOCK_TOKENS, TOKENS_BY_AXIS } from './tokens'
export type { BlockStyleAxis, BlockToken } from './tokens'

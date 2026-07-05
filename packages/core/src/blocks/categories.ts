/** The canonical block taxonomy. Order is the grouped-menu display order. */
export const BLOCK_CATEGORIES = [
  'text',
  'media',
  'layout',
  'embed',
  'dynamic',
  'marketing',
  'widget'
] as const

export type BlockCategory = (typeof BLOCK_CATEGORIES)[number]

/** Human label per category (presentation-agnostic; admin maps the icon). */
export const BLOCK_CATEGORY_LABELS: Record<BlockCategory, string> = {
  text: 'Text',
  media: 'Media',
  layout: 'Layout',
  embed: 'Embeds',
  dynamic: 'Dynamic',
  marketing: 'Marketing',
  widget: 'Widgets'
}

/** Fallback category for a block that declares no group. */
export const DEFAULT_BLOCK_CATEGORY: BlockCategory = 'text'

export function isBlockCategory(v: string): v is BlockCategory {
  return (BLOCK_CATEGORIES as readonly string[]).includes(v)
}

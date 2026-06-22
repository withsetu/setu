import type { Editor, Range } from '@tiptap/core'
import type { IconName } from '../ui/Icon'
import { BLOCK_CATEGORIES, BLOCK_CATEGORY_LABELS } from '@setu/core'
import type { BlockCategory } from '@setu/core'

/** One insertable block in the slash menu. `run` performs the insertion. */
export interface SlashBlock {
  title: string
  subtitle: string
  icon: IconName
  group: BlockCategory
  keywords: string[]
  run: (editor: Editor, range: Range) => void
}

/** A render row: a non-selectable category header, or a selectable item carrying
 *  its sequential keyboard index (`itemIndex`). */
export type SlashRow =
  | { kind: 'header'; category: BlockCategory; label: string }
  | { kind: 'item'; block: SlashBlock; itemIndex: number }

/** Relevance score of a block against an already-lowercased, already-trimmed query.
 *  0 means no match (the block is filtered out). Higher wins. */
export function scoreBlock(block: SlashBlock, q: string): number {
  const title = block.title.toLowerCase()
  const keywords = block.keywords.map((k) => k.toLowerCase())
  if (title === q) return 100
  if (title.startsWith(q)) return 80
  if (keywords.some((k) => k === q)) return 70
  if (title.includes(q)) return 50
  if (keywords.some((k) => k.includes(q))) return 40
  if (block.subtitle.toLowerCase().includes(q)) return 20
  return 0
}

/** Build the slash-menu row list. Empty query → grouped by category in canonical
 *  order (empty categories omitted). Non-empty query → flat list ranked by score,
 *  no headers. `itemIndex` is the selectable-item index for keyboard nav. */
export function slashRenderModel(blocks: SlashBlock[], query: string): SlashRow[] {
  const q = query.trim().toLowerCase()

  if (q === '') {
    const rows: SlashRow[] = []
    let itemIndex = 0
    for (const category of BLOCK_CATEGORIES) {
      const inGroup = blocks.filter((b) => b.group === category)
      if (inGroup.length === 0) continue
      rows.push({ kind: 'header', category, label: BLOCK_CATEGORY_LABELS[category] })
      for (const block of inGroup) rows.push({ kind: 'item', block, itemIndex: itemIndex++ })
    }
    return rows
  }

  return blocks
    .map((block, order) => ({ block, score: scoreBlock(block, q), order }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((s, itemIndex) => ({ kind: 'item', block: s.block, itemIndex }))
}

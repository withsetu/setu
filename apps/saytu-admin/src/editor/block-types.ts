import type { Editor, ChainedCommands } from '@tiptap/core'
import type { IconName } from '../ui/Icon'

/** One block-type the editor can turn a block into. `isActive` reports whether the
 *  current selection is already that type; `setOn` applies the transform to a chain.
 *  Single source of truth shared by the slash menu (insert) and the bubble's
 *  Turn-into dropdown (transform). All types round-trip through the core converter. */
export interface BlockType {
  id: string
  label: string
  icon: IconName
  isActive: (editor: Editor) => boolean
  setOn: (chain: ChainedCommands) => ChainedCommands
}

export const BLOCK_TYPES: BlockType[] = [
  { id: 'paragraph', label: 'Text', icon: 'post', isActive: (e) => e.isActive('paragraph'), setOn: (c) => c.setNode('paragraph') },
  { id: 'h2', label: 'Heading 2', icon: 'pages', isActive: (e) => e.isActive('heading', { level: 2 }), setOn: (c) => c.setNode('heading', { level: 2 }) },
  { id: 'h3', label: 'Heading 3', icon: 'pages', isActive: (e) => e.isActive('heading', { level: 3 }), setOn: (c) => c.setNode('heading', { level: 3 }) },
  { id: 'h4', label: 'Heading 4', icon: 'pages', isActive: (e) => e.isActive('heading', { level: 4 }), setOn: (c) => c.setNode('heading', { level: 4 }) },
  { id: 'bulletList', label: 'Bullet list', icon: 'forms', isActive: (e) => e.isActive('bulletList'), setOn: (c) => c.toggleBulletList() },
  { id: 'orderedList', label: 'Numbered list', icon: 'forms', isActive: (e) => e.isActive('orderedList'), setOn: (c) => c.toggleOrderedList() },
  { id: 'blockquote', label: 'Quote', icon: 'post', isActive: (e) => e.isActive('blockquote'), setOn: (c) => c.toggleBlockquote() },
  { id: 'codeBlock', label: 'Code block', icon: 'settings', isActive: (e) => e.isActive('codeBlock'), setOn: (c) => c.toggleCodeBlock() },
]

/** The block type of the current selection — the first non-Text type that's active
 *  (so a list/quote/heading wins over its inner paragraph), else Text. */
export function currentBlockType(editor: Editor): BlockType {
  const nonText = BLOCK_TYPES.slice(1).find((b) => b.isActive(editor))
  return nonText ?? BLOCK_TYPES[0]!
}

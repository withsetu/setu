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
  keys: string[]
  isActive: (editor: Editor) => boolean
  setOn: (chain: ChainedCommands) => ChainedCommands
}

export const BLOCK_TYPES: BlockType[] = [
  {
    id: 'paragraph',
    label: 'Text',
    icon: 'post',
    keys: ['Mod', 'Alt', '0'],
    isActive: (e) => e.isActive('paragraph'),
    setOn: (c) => c.setNode('paragraph')
  },
  {
    id: 'h2',
    label: 'Heading 2',
    icon: 'pages',
    keys: ['Mod', 'Alt', '2'],
    isActive: (e) => e.isActive('heading', { level: 2 }),
    setOn: (c) => c.setNode('heading', { level: 2 })
  },
  {
    id: 'h3',
    label: 'Heading 3',
    icon: 'pages',
    keys: ['Mod', 'Alt', '3'],
    isActive: (e) => e.isActive('heading', { level: 3 }),
    setOn: (c) => c.setNode('heading', { level: 3 })
  },
  {
    id: 'h4',
    label: 'Heading 4',
    icon: 'pages',
    keys: ['Mod', 'Alt', '4'],
    isActive: (e) => e.isActive('heading', { level: 4 }),
    setOn: (c) => c.setNode('heading', { level: 4 })
  },
  {
    id: 'bulletList',
    label: 'Bullet list',
    icon: 'forms',
    keys: ['Mod', 'Shift', '8'],
    isActive: (e) => e.isActive('bulletList'),
    setOn: (c) => c.toggleBulletList()
  },
  {
    id: 'orderedList',
    label: 'Numbered list',
    icon: 'forms',
    keys: ['Mod', 'Shift', '7'],
    isActive: (e) => e.isActive('orderedList'),
    setOn: (c) => c.toggleOrderedList()
  },
  {
    id: 'blockquote',
    label: 'Quote',
    icon: 'post',
    keys: ['Mod', 'Shift', 'b'],
    isActive: (e) => e.isActive('blockquote'),
    setOn: (c) => c.toggleBlockquote()
  },
  {
    id: 'codeBlock',
    label: 'Code block',
    icon: 'settings',
    keys: ['Mod', 'Alt', 'c'],
    isActive: (e) => e.isActive('codeBlock'),
    setOn: (c) => c.toggleCodeBlock()
  },
  {
    id: 'taskList',
    label: 'Checklist',
    icon: 'check',
    keys: ['Mod', 'Shift', '9'],
    isActive: (e) => e.isActive('taskList'),
    setOn: (c) => c.toggleTaskList()
  }
]

/** The block type of the current selection — the first non-Text type that's active
 *  (so a list/quote/heading wins over its inner paragraph), else Text. */
export function currentBlockType(editor: Editor): BlockType {
  const nonText = BLOCK_TYPES.slice(1).find((b) => b.isActive(editor))
  return nonText ?? BLOCK_TYPES[0]!
}

/** A row in the bubble's Turn-into menu: a leaf applies a block type directly; a
 *  group expands inline to its items. Derived from BLOCK_TYPES (same objects) so the
 *  transforms/active-state are single-sourced. */
export type TurnIntoEntry =
  | { kind: 'leaf'; type: BlockType }
  | {
      kind: 'group'
      id: string
      label: string
      icon: IconName
      items: BlockType[]
    }

function byId(id: string): BlockType {
  const b = BLOCK_TYPES.find((x) => x.id === id)
  if (!b) throw new Error(`block-types: unknown id ${id}`)
  return b
}

export const TURN_INTO_GROUPS: TurnIntoEntry[] = [
  { kind: 'leaf', type: byId('paragraph') },
  {
    kind: 'group',
    id: 'heading',
    label: 'Heading',
    icon: 'pages',
    items: [byId('h2'), byId('h3'), byId('h4')]
  },
  {
    kind: 'group',
    id: 'list',
    label: 'List',
    icon: 'forms',
    items: [byId('bulletList'), byId('orderedList'), byId('taskList')]
  },
  { kind: 'leaf', type: byId('blockquote') },
  { kind: 'leaf', type: byId('codeBlock') }
]

/** The id of the group whose item is currently active (so the menu can pre-expand it),
 *  or null when the active block is a leaf/plain paragraph. */
export function groupContaining(editor: Editor): string | null {
  for (const e of TURN_INTO_GROUPS) {
    if (e.kind === 'group' && e.items.some((it) => it.isActive(editor)))
      return e.id
  }
  return null
}

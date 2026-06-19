import type { Editor, Range } from '@tiptap/core'
import { isIconName } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { registry } from '../blocks/registry'
import { BLOCK_TYPES } from './block-types'

export interface SlashBlock {
  title: string
  subtitle: string
  icon: IconName
  run: (editor: Editor, range: Range) => void
}

const SUBTITLES: Record<string, string> = {
  paragraph: 'Plain paragraph',
  h2: 'Large section heading',
  h3: 'Medium section heading',
  h4: 'Small section heading',
  bulletList: 'Simple bulleted list',
  orderedList: 'Ordered list',
  blockquote: 'Block quote',
  codeBlock: 'Code block',
  taskList: 'Checklist with checkboxes',
}

const BUILTINS: SlashBlock[] = [
  ...BLOCK_TYPES.map((b) => ({
    title: b.label,
    subtitle: SUBTITLES[b.id] ?? b.label,
    icon: b.icon,
    run: (e: Editor, r: Range) => b.setOn(e.chain().focus().deleteRange(r)).run(),
  })),
  { title: 'Divider', subtitle: 'Horizontal rule', icon: 'settings', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { title: 'Table', subtitle: 'Table with header row', icon: 'table', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
]

const toIconName = (raw: string | undefined): IconName => (raw && isIconName(raw) ? raw : 'sparkle')

/** Insertable blocks = built-ins + every auto-discovered folder block. Each folder block
 *  inserts a node of its tag (today only `callout` has an editor node). */
export function slashBlocks(): SlashBlock[] {
  const fromBlocks: SlashBlock[] = registry.blocks.map((b) => ({
    title: b.editor?.label ?? b.tag,
    subtitle: `Insert a ${b.tag} block`,
    icon: toIconName(b.editor?.icon),
    run: (e: Editor, r: Range) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({ type: b.tag, attrs: { mdAttrs: { type: 'info' } }, content: [{ type: 'paragraph' }] })
        .run(),
  }))
  return [...BUILTINS, ...fromBlocks]
}

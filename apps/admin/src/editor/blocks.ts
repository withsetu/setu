import type { Editor, Range } from '@tiptap/core'
import { isIconName } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { registry } from '../blocks/registry'
import { BLOCK_TYPES } from './block-types'
import { pickImageAndInsert } from './image-insert'

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
  { title: 'Image', subtitle: 'Pick or upload an image', icon: 'image', run: (e, r) => {
    e.chain().focus().deleteRange(r).run()
    const storage = (e.storage as unknown as { imageBlock?: { openPicker?: () => void } }).imageBlock
    if (storage?.openPicker) {
      storage.openPicker()
    } else {
      // Fallback: direct upload (no modal wired yet)
      const editor = e as Editor & { storage: { imageBlock?: { onUploading?: (b: boolean) => void; onError?: (m: string) => void } } }
      pickImageAndInsert(editor, (import.meta.env.VITE_SETU_API as string) ?? '', editor.storage.imageBlock ?? {})
    }
  } },
]

const toIconName = (raw: string | undefined): IconName => (raw && isIconName(raw) ? raw : 'sparkle')

/** Insertable blocks = built-ins + every auto-discovered folder block. Each folder block
 *  inserts a node of its tag (today only `callout` has an editor node). */
export function slashBlocks(): SlashBlock[] {
  const fromBlocks: SlashBlock[] = registry.blocks.map((b) => ({
    title: b.editor?.label ?? b.tag,
    subtitle: `Insert a ${b.tag} block`,
    icon: toIconName(b.editor?.icon),
    run: (e: Editor, r: Range) => {
      const chain = e.chain().focus().deleteRange(r)
      if (b.tag === 'callout') {
        // Callout has its own dedicated React editor node.
        chain.insertContent({ type: 'callout', attrs: { mdAttrs: { type: 'info' } }, content: [{ type: 'paragraph' }] })
      } else {
        // Every other folder block uses the generic node, keyed by tag.
        chain.insertContent({ type: 'setuBlock', attrs: { tag: b.tag, mdAttrs: {} }, content: [{ type: 'paragraph' }] })
      }
      chain.run()
    },
  }))
  return [...BUILTINS, ...fromBlocks]
}

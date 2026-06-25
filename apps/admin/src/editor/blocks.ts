import type { Editor, Range } from '@tiptap/core'
import { isIconName } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { DEFAULT_BLOCK_CATEGORY } from '@setu/core'
import type { BlockCategory } from '@setu/core'
import { registry } from '../blocks/registry'
import { BLOCK_TYPES } from './block-types'
import { pickImageAndInsert, imageBlockFromSrc } from './image-insert'
import { ensureFormId, DEFAULT_SUCCESS_MESSAGE } from './extensions/contact-helpers'
import type { SlashBlock } from './slash-model'

export type { SlashBlock } from './slash-model'

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

// Per built-in block id: its category + extra search aliases.
const BUILTIN_META: Record<string, { group: BlockCategory; keywords: string[] }> = {
  paragraph: { group: 'text', keywords: ['text', 'body', 'p'] },
  h2: { group: 'text', keywords: ['heading', 'title', 'h2'] },
  h3: { group: 'text', keywords: ['heading', 'subheading', 'h3'] },
  h4: { group: 'text', keywords: ['heading', 'h4'] },
  bulletList: { group: 'text', keywords: ['bullets', 'ul', 'unordered'] },
  orderedList: { group: 'text', keywords: ['numbered', 'ol'] },
  blockquote: { group: 'text', keywords: ['quote', 'cite'] },
  codeBlock: { group: 'text', keywords: ['code', 'pre', 'snippet'] },
  taskList: { group: 'text', keywords: ['todo', 'checklist', 'checkbox'] },
}

const BUILTINS: SlashBlock[] = [
  ...BLOCK_TYPES.map((b) => ({
    title: b.label,
    subtitle: SUBTITLES[b.id] ?? b.label,
    icon: b.icon,
    group: BUILTIN_META[b.id]?.group ?? DEFAULT_BLOCK_CATEGORY,
    keywords: BUILTIN_META[b.id]?.keywords ?? [],
    run: (e: Editor, r: Range) => b.setOn(e.chain().focus().deleteRange(r)).run(),
  })),
  { title: 'Divider', subtitle: 'Horizontal rule', icon: 'divider', group: 'text', keywords: ['hr', 'rule', 'separator', 'line'], run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { title: 'Table', subtitle: 'Table with header row', icon: 'table', group: 'layout', keywords: ['grid', 'rows', 'columns'], run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: 'Image', subtitle: 'Pick or upload an image', icon: 'image', group: 'media', keywords: ['img', 'photo', 'picture', 'media'], run: (e, r) => {
    e.chain().focus().deleteRange(r).run()
    const storage = (e.storage as unknown as { imageBlock?: { openPicker?: (onPick: (src: string) => void) => void } }).imageBlock
    if (storage?.openPicker) {
      storage.openPicker((src) => e.chain().focus().insertContent(imageBlockFromSrc(src)).run())
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
    group: b.editor?.group ?? DEFAULT_BLOCK_CATEGORY,
    keywords: b.editor?.keywords ?? [],
    run: (e: Editor, r: Range) => {
      const chain = e.chain().focus().deleteRange(r)
      if (b.tag === 'contact') {
        chain.insertContent({
          type: 'contactBlock',
          attrs: {
            mdAttrs: ensureFormId({
              formLabel: 'Contact',
              subject: false,
              nameRequired: true,
              subjectRequired: false,
              messageRequired: true,
              successMessage: DEFAULT_SUCCESS_MESSAGE,
            }),
          },
        })
      } else if (b.tag === 'callout') {
        chain.insertContent({ type: 'callout', attrs: { mdAttrs: { type: 'info' } }, content: [{ type: 'paragraph' }] })
      } else {
        chain.insertContent({ type: 'setuBlock', attrs: { tag: b.tag, mdAttrs: {} }, content: [{ type: 'paragraph' }] })
      }
      chain.run()
    },
  }))
  return [...BUILTINS, ...fromBlocks]
}

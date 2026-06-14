import type { Editor, Range } from '@tiptap/core'
import { isIconName } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { defaultConfig, resolveConfig } from '@saytu/core'

export interface SlashBlock {
  title: string
  subtitle: string
  icon: IconName
  run: (editor: Editor, range: Range) => void
}

const BUILTINS: SlashBlock[] = [
  { title: 'Text', subtitle: 'Plain paragraph', icon: 'post', run: (e, r) => e.chain().focus().deleteRange(r).setNode('paragraph').run() },
  { title: 'Heading 1', subtitle: 'Large section heading', icon: 'pages', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run() },
  { title: 'Heading 2', subtitle: 'Medium section heading', icon: 'pages', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run() },
  { title: 'Bullet list', subtitle: 'Simple bulleted list', icon: 'forms', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { title: 'Numbered list', subtitle: 'Ordered list', icon: 'forms', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { title: 'Quote', subtitle: 'Block quote', icon: 'post', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { title: 'Code', subtitle: 'Code block', icon: 'settings', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { title: 'Divider', subtitle: 'Horizontal rule', icon: 'settings', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
]

const toIconName = (raw: string | undefined): IconName => (raw && isIconName(raw) ? raw : 'sparkle')

/** Insertable blocks = built-ins + the resolved config blocks (Callout). Each
 *  config block inserts a node of its tag (only `callout` has a node today). */
export function slashBlocks(): SlashBlock[] {
  const config = resolveConfig(defaultConfig)
  const fromConfig: SlashBlock[] = config.blocks.map((b) => ({
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
  return [...BUILTINS, ...fromConfig]
}

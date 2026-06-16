import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { LinkInput } from './LinkInput'

interface MarkBtn {
  name: string
  label: string
  icon: IconName
  toggle: (e: Editor) => void
}

const MARKS: MarkBtn[] = [
  { name: 'bold', label: 'Bold', icon: 'bold', toggle: (e) => e.chain().focus().toggleBold().run() },
  { name: 'italic', label: 'Italic', icon: 'italic', toggle: (e) => e.chain().focus().toggleItalic().run() },
  { name: 'code', label: 'Inline code', icon: 'code', toggle: (e) => e.chain().focus().toggleCode().run() },
  { name: 'strike', label: 'Strikethrough', icon: 'strike', toggle: (e) => e.chain().focus().toggleStrike().run() },
]

/** Make a user-typed URL absolute: a bare domain like `example.com` becomes
 *  `https://example.com` (otherwise the browser treats it as a path relative to the
 *  current page). Leaves an explicit scheme (`http:`, `mailto:`…) and root/anchor
 *  links (`/path`, `#id`) untouched. */
export function normalizeUrl(href: string): string {
  const trimmed = href.trim()
  if (trimmed === '') return trimmed
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed // has a scheme
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed // relative/anchor
  return `https://${trimmed}`
}

/** Presentational toolbar — rendered unconditionally so it is unit-testable. */
export function FormatBubbleToolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      code: e.isActive('code'),
      strike: e.isActive('strike'),
      link: e.isActive('link'),
      from: e.state.selection.from,
      to: e.state.selection.to,
    }),
  }) ?? { bold: false, italic: false, code: false, strike: false, link: false, from: 0, to: 0 }

  const [linking, setLinking] = useState(false)
  useEffect(() => {
    setLinking(false)
  }, [active.from, active.to])
  const currentHref = (editor.getAttributes('link').href as string | undefined) ?? ''

  if (linking) {
    return (
      <div className="fmt-bubble" role="toolbar" aria-label="Text formatting">
        <LinkInput
          initial={currentHref}
          onApply={(href) => {
            const ok = editor.chain().focus().extendMarkRange('link').setLink({ href: normalizeUrl(href) }).run()
            if (ok) setLinking(false)
          }}
          onCancel={() => {
            setLinking(false)
            editor.commands.focus()
          }}
          onRemove={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            setLinking(false)
          }}
        />
      </div>
    )
  }

  return (
    <div className="fmt-bubble" role="toolbar" aria-label="Text formatting">
      {MARKS.map((m) => (
        <button
          key={m.name}
          type="button"
          className={`fmt-btn${active[m.name as keyof typeof active] ? ' on' : ''}`}
          aria-label={m.label}
          aria-pressed={!!active[m.name as keyof typeof active]}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => m.toggle(editor)}
        >
          <Icon name={m.icon} size={16} />
        </button>
      ))}
      <button
        type="button"
        className={`fmt-btn${active.link ? ' on' : ''}`}
        aria-label="Link"
        aria-pressed={active.link}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setLinking(true)}
      >
        <Icon name="link" size={16} />
      </button>
    </div>
  )
}

/** Selection bubble: shows the formatting toolbar on a non-empty text selection. */
export function FormatBubble({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state }) =>
        e.isEditable && state.selection instanceof TextSelection && !state.selection.empty
      }
    >
      <FormatBubbleToolbar editor={editor} />
    </BubbleMenu>
  )
}

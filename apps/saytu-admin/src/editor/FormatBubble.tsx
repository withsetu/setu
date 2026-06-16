import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import { useState } from 'react'
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
    }),
  }) ?? { bold: false, italic: false, code: false, strike: false, link: false }

  const [linking, setLinking] = useState(false)
  const currentHref = (editor.getAttributes('link').href as string | undefined) ?? ''

  if (linking) {
    return (
      <div className="fmt-bubble" role="toolbar" aria-label="Text formatting">
        <LinkInput
          initial={currentHref}
          onApply={(href) => {
            editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
            setLinking(false)
          }}
          onCancel={() => setLinking(false)}
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
          aria-pressed={active[m.name as keyof typeof active]}
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

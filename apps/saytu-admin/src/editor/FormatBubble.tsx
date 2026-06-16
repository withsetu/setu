import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

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
  return (
    <div className="fmt-bubble" role="toolbar" aria-label="Text formatting">
      {MARKS.map((m) => (
        <button
          key={m.name}
          type="button"
          className={`fmt-btn${editor.isActive(m.name) ? ' on' : ''}`}
          aria-label={m.label}
          aria-pressed={editor.isActive(m.name)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => m.toggle(editor)}
        >
          <Icon name={m.icon} size={16} />
        </button>
      ))}
      <button
        type="button"
        className={`fmt-btn${editor.isActive('link') ? ' on' : ''}`}
        aria-label="Link"
        aria-pressed={editor.isActive('link')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          /* Link input wired in Task 2 */
        }}
      >
        <Icon name="link" size={16} />
      </button>
    </div>
  )
}

/** Selection bubble: shows the formatting toolbar on a non-empty text selection. */
export function FormatBubble({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu editor={editor} shouldShow={({ editor: e, state }) => e.isEditable && !state.selection.empty}>
      <FormatBubbleToolbar editor={editor} />
    </BubbleMenu>
  )
}

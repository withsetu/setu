import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import '@tiptap/extension-subscript'
import '@tiptap/extension-superscript'
import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { LinkInput } from './LinkInput'
import { Tooltip } from './Tooltip'
import { SHORTCUTS, formatKeys, ariaKeyshortcuts, detectMac } from './shortcuts'
import { onRequestLinkEdit, onRequestFocusToolbar } from './editor-events'
import { isEscape, collapseSelectionOnEscape } from './dismiss'
import { TurnIntoMenu } from './TurnIntoMenu'
import { useToolbarRoving } from './useToolbarRoving'
import { bubbleEscapeShouldCollapse, registerBubblePopup } from './bubble-popup'

interface MarkBtn {
  name: string
  label: string
  icon: IconName
  toggle: (e: Editor) => void
}

const MARKS: MarkBtn[] = [
  {
    name: 'bold',
    label: 'Bold',
    icon: 'bold',
    toggle: (e) => e.chain().focus().toggleBold().run()
  },
  {
    name: 'italic',
    label: 'Italic',
    icon: 'italic',
    toggle: (e) => e.chain().focus().toggleItalic().run()
  },
  {
    name: 'code',
    label: 'Inline code',
    icon: 'code',
    toggle: (e) => e.chain().focus().toggleCode().run()
  },
  {
    name: 'strike',
    label: 'Strikethrough',
    icon: 'strike',
    toggle: (e) => e.chain().focus().toggleStrike().run()
  },
  {
    name: 'subscript',
    label: 'Subscript',
    icon: 'subscript',
    toggle: (e) => e.chain().focus().toggleSubscript().run()
  },
  {
    name: 'superscript',
    label: 'Superscript',
    icon: 'superscript',
    toggle: (e) => e.chain().focus().toggleSuperscript().run()
  }
]

interface AlignBtn {
  id: string
  label: string
  icon: IconName
  apply: (e: Editor) => void
}
const ALIGNS: AlignBtn[] = [
  {
    id: 'alignLeft',
    label: 'Align left',
    icon: 'alignLeft',
    apply: (e) => e.chain().focus().unsetTextAlign().run()
  },
  {
    id: 'alignCenter',
    label: 'Align center',
    icon: 'alignCenter',
    apply: (e) => e.chain().focus().setTextAlign('center').run()
  },
  {
    id: 'alignRight',
    label: 'Align right',
    icon: 'alignRight',
    apply: (e) => e.chain().focus().setTextAlign('right').run()
  }
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
      subscript: e.isActive('subscript'),
      superscript: e.isActive('superscript'),
      link: e.isActive('link'),
      alignCenter: e.isActive({ textAlign: 'center' }),
      alignRight: e.isActive({ textAlign: 'right' }),
      from: e.state.selection.from,
      to: e.state.selection.to
    })
  }) ?? {
    bold: false,
    italic: false,
    code: false,
    strike: false,
    subscript: false,
    superscript: false,
    link: false,
    alignCenter: false,
    alignRight: false,
    from: 0,
    to: 0
  }

  const mac = detectMac()
  const shortcutFor = (id: string) => SHORTCUTS.find((s) => s.id === id)
  const tipFor = (id: string, fallback: string) => {
    const s = shortcutFor(id)
    return s ? `${s.label}  ${formatKeys(s.keys, mac)}` : fallback
  }
  const ariaFor = (id: string) => {
    const s = shortcutFor(id)
    return s ? ariaKeyshortcuts(s.keys) : undefined
  }

  const { ref: toolbarRef, onKeyDown: onToolbarKeyDown } = useToolbarRoving()

  const [linking, setLinking] = useState(false)
  // While the link input is open it owns Esc — register so the bubble's document
  // Esc handler defers (one Esc cancels the input, leaving the selection intact).
  useEffect(() => {
    if (!linking) return
    return registerBubblePopup()
  }, [linking])
  useEffect(() => {
    setLinking(false)
  }, [active.from, active.to])
  useEffect(() => onRequestLinkEdit(() => setLinking(true)), [])
  // Tab from the editor (on a selection) moves focus into the toolbar — land on its
  // first control (the Turn-into trigger).
  useEffect(
    () =>
      onRequestFocusToolbar(() => {
        const first = toolbarRef.current?.querySelector<HTMLElement>(
          '[data-toolbar-item]'
        )
        first?.focus()
      }),
    [toolbarRef]
  )
  const currentHref =
    (editor.getAttributes('link').href as string | undefined) ?? ''

  if (linking) {
    return (
      <div className="fmt-bubble" role="toolbar" aria-label="Text formatting">
        <LinkInput
          initial={currentHref}
          onApply={(href) => {
            const ok = editor
              .chain()
              .focus()
              .extendMarkRange('link')
              .setLink({ href: normalizeUrl(href) })
              .run()
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
    <div
      ref={toolbarRef}
      className="fmt-bubble"
      role="toolbar"
      aria-label="Text formatting"
      onKeyDown={(e) => {
        onToolbarKeyDown(e)
        if (isEscape(e.nativeEvent)) {
          e.preventDefault()
          collapseSelectionOnEscape(editor)
        }
      }}
    >
      <TurnIntoMenu editor={editor} />
      {MARKS.map((m) => (
        <Tooltip key={m.name} content={tipFor(m.name, m.label)}>
          <button
            type="button"
            data-toolbar-item
            className={`fmt-btn${active[m.name as keyof typeof active] ? ' on' : ''}`}
            aria-label={m.label}
            aria-keyshortcuts={ariaFor(m.name)}
            aria-pressed={!!active[m.name as keyof typeof active]}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => m.toggle(editor)}
          >
            <Icon name={m.icon} size={16} />
          </button>
        </Tooltip>
      ))}
      {ALIGNS.map((a) => {
        const pressed =
          a.id === 'alignCenter'
            ? active.alignCenter
            : a.id === 'alignRight'
              ? active.alignRight
              : !active.alignCenter && !active.alignRight
        return (
          <Tooltip key={a.id} content={tipFor(a.id, a.label)}>
            <button
              type="button"
              data-toolbar-item
              className={`fmt-btn${pressed ? ' on' : ''}`}
              aria-label={a.label}
              aria-keyshortcuts={ariaFor(a.id)}
              aria-pressed={pressed}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => a.apply(editor)}
            >
              <Icon name={a.icon} size={16} />
            </button>
          </Tooltip>
        )
      })}
      <Tooltip content={tipFor('link', 'Link')}>
        <button
          type="button"
          data-toolbar-item
          className={`fmt-btn${active.link ? ' on' : ''}`}
          aria-label="Link"
          aria-keyshortcuts={ariaFor('link')}
          aria-pressed={active.link}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setLinking(true)}
        >
          <Icon name="link" size={16} />
        </button>
      </Tooltip>
    </div>
  )
}

/** Selection bubble: shows the formatting toolbar on a non-empty text selection. */
export function FormatBubble({ editor }: { editor: Editor }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isEscape(e)) return
      // Defer to an inner popup (Turn-into menu / link input) when one is open —
      // its own Esc closes it; this listener must not also collapse the selection.
      if (!bubbleEscapeShouldCollapse(editor)) return
      e.preventDefault()
      collapseSelectionOnEscape(editor)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editor])

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state }) =>
        e.isEditable &&
        state.selection instanceof TextSelection &&
        !state.selection.empty
      }
    >
      <FormatBubbleToolbar editor={editor} />
    </BubbleMenu>
  )
}

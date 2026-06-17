import { useRef } from 'react'
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import tippy from 'tippy.js'
import type { Instance as TippyInstance } from 'tippy.js'
import type { TiptapDoc } from '@saytu/core'
import { BlockActions } from './extensions/BlockActions'
import { DragHandle } from './extensions/DragHandle'
import { BlockMenu } from './extensions/BlockMenu'
import { Callout } from './extensions/Callout'
import { Passthrough } from './extensions/Passthrough'
import { SlashCommand } from './extensions/SlashCommand'
import { KeyboardShortcuts } from './extensions/KeyboardShortcuts'
import { requestLinkEdit } from './editor-events'
import { LinkTools } from './extensions/LinkTools'
import { FormatBubble } from './FormatBubble'

export function Canvas({
  initialContent,
  editable,
  onChange,
}: {
  initialContent: TiptapDoc
  editable: boolean
  onChange: (doc: TiptapDoc) => void
}) {
  const editorRef = useRef<Editor | null>(null)

  const dragHandle = DragHandle.configure({
    onMenu: (view: EditorView, index: number, anchor: HTMLElement) => {
      let popup: TippyInstance[] = []
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        popup[0]?.destroy()
        renderer.destroy()
        editorRef.current?.commands.focus()
      }
      const renderer = new ReactRenderer(BlockMenu, {
        editor: editorRef.current!,
        props: {
          canMoveUp: index > 0,
          canMoveDown: index < view.state.doc.childCount - 1,
          onClose: close,
          actions: {
            moveUp: () => editorRef.current?.commands.moveBlockUp(),
            moveDown: () => editorRef.current?.commands.moveBlockDown(),
            duplicate: () => editorRef.current?.commands.duplicateBlock(),
            remove: () => editorRef.current?.commands.deleteBlock(),
          },
        },
      })
      popup = tippy('body', {
        getReferenceClientRect: () => anchor.getBoundingClientRect(),
        appendTo: () => document.body,
        content: renderer.element,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
        onHidden: close,
      })
    },
  })

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: false }),
      Placeholder.configure({ placeholder: "Type '/' for commands…" }),
      Subscript,
      Superscript,
      BlockActions,
      KeyboardShortcuts,
      dragHandle,
      Callout,
      Passthrough,
      SlashCommand,
      LinkTools.configure({
        onEdit: (ed) => {
          ed.chain().focus().extendMarkRange('link').run()
          // Open the URL field directly (not just the bubble): defer so the bubble
          // has mounted + subscribed to onRequestLinkEdit after the selection change.
          setTimeout(() => requestLinkEdit(), 0)
        },
      }),
    ],
    content: initialContent,
    editorProps: { attributes: { class: 'saytu-prose', 'aria-label': 'Content editor' } },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as TiptapDoc),
  })
  editorRef.current = editor

  return (
    <>
      <EditorContent editor={editor} />
      {editor && <FormatBubble editor={editor} />}
    </>
  )
}

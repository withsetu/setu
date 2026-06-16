import { useRef } from 'react'
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
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
      const close = () => {
        popup[0]?.destroy()
        renderer.destroy()
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
      StarterKit,
      Placeholder.configure({ placeholder: "Type '/' for commands…" }),
      BlockActions,
      dragHandle,
      Callout,
      Passthrough,
      SlashCommand,
    ],
    content: initialContent,
    editorProps: { attributes: { class: 'saytu-prose', 'aria-label': 'Content editor' } },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as TiptapDoc),
  })
  editorRef.current = editor

  return <EditorContent editor={editor} />
}

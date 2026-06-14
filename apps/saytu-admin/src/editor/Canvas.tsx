import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type { TiptapDoc } from '@saytu/core'
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
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Type '/' for commands…" }),
      Callout,
      Passthrough,
      SlashCommand,
    ],
    content: initialContent,
    editorProps: { attributes: { class: 'saytu-prose', 'aria-label': 'Content editor' } },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as TiptapDoc),
  })

  return <EditorContent editor={editor} />
}

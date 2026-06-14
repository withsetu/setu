import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Callout, PassthroughChip } from './nodes'
import { SlashCommand } from './slash-command'

const INITIAL = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Summer Launch' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Our biggest release yet. Type ' },
        { type: 'text', marks: [{ type: 'code' }], text: '/' },
        { type: 'text', text: ' anywhere to insert a block.' },
      ],
    },
    { type: 'callout', content: [{ type: 'text', text: 'Pre-orders open Friday — limited stock.' }] },
    {
      type: 'passthrough',
      attrs: { label: 'Show banner if Black Friday', raw: '{% if $flags.blackFriday %}' },
    },
    { type: 'paragraph' },
  ],
}

export function Editor({ onUpdate }: { onUpdate?: (info: { words: number }) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'paragraph' ? "Type '/' for commands…" : '',
      }),
      Callout,
      PassthroughChip,
      SlashCommand,
    ],
    content: INITIAL,
    editorProps: {
      attributes: {
        class: 'saytu-prose focus:outline-none',
        'aria-label': 'Content editor',
      },
    },
    onUpdate: ({ editor }) => {
      const words = editor.getText().split(/\s+/).filter(Boolean).length
      onUpdate?.({ words })
    },
  })

  return <EditorContent editor={editor} />
}

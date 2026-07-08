import { useRef, useState, useEffect } from 'react'
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import {
  Table,
  TableRow,
  TableHeader,
  TableCell
} from '@tiptap/extension-table'
import { TextAlign } from '@tiptap/extension-text-align'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import tippy from 'tippy.js'
import type { Instance as TippyInstance } from 'tippy.js'
import type { TiptapDoc } from '@setu/core'
import { blockCores } from '@setu/blocks'
import { registry } from '../blocks/registry'
import { BlockActions } from './extensions/BlockActions'
import { DragHandle } from './extensions/DragHandle'
import { BlockMenu } from './extensions/BlockMenu'
import { Callout } from './extensions/Callout'
import { ContactBlock } from './extensions/ContactBlock'
import { HeroBlock } from './extensions/HeroBlock'
import { QueryBlock } from './extensions/QueryBlock'
import { EmbedBlock } from './extensions/EmbedBlock'
import { EmbedPaste } from './extensions/EmbedPaste'
import type { RunQuery } from './QueryPreview'
import { createSetuBlock } from './extensions/SetuBlock'
import { Image } from './extensions/Image'
import { ImageBlock } from './extensions/ImageBlock'
import { Passthrough } from './extensions/Passthrough'
import { SlashCommand } from './extensions/SlashCommand'
import { KeyboardShortcuts } from './extensions/KeyboardShortcuts'
import { requestLinkEdit } from './editor-events'
import { LinkTools } from './extensions/LinkTools'
import { FormatBubble } from './FormatBubble'
import { TableMenu } from './TableMenu'
import { MediaPickerModal } from './MediaPickerModal'
import { useNotify } from '../ui/notify'

const cellAlign = {
  align: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.style.textAlign || null,
    renderHTML: (attrs: { align?: string | null }) =>
      attrs.align ? { style: `text-align: ${attrs.align}` } : {}
  }
}
const AlignTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAlign }
  }
})
const AlignTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAlign }
  }
})

export function Canvas({
  initialContent,
  editable,
  onChange,
  onEditor,
  runQuery
}: {
  initialContent: TiptapDoc
  editable: boolean
  onChange: (doc: TiptapDoc) => void
  onEditor?: (e: Editor | null) => void
  runQuery?: RunQuery
}) {
  const editorRef = useRef<Editor | null>(null)
  const notify = useNotify()

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
            remove: () => editorRef.current?.commands.deleteBlock()
          }
        }
      })
      popup = tippy('body', {
        getReferenceClientRect: () => anchor.getBoundingClientRect(),
        appendTo: () => document.body,
        content: renderer.element,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
        onHidden: close
      })
    }
  })

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: false }),
      Placeholder.configure({ placeholder: "Type '/' for commands…" }),
      // Mutually exclusive: a glyph can't be both below and above the baseline —
      // applying one clears the other.
      Subscript.extend({ excludes: 'superscript' }),
      Superscript.extend({ excludes: 'subscript' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      AlignTableHeader,
      AlignTableCell,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right']
      }),
      BlockActions,
      KeyboardShortcuts,
      dragHandle,
      Callout,
      ContactBlock,
      HeroBlock,
      QueryBlock.configure({ runQuery }),
      EmbedBlock,
      EmbedPaste.configure({
        apiBase: (import.meta.env.VITE_SETU_API as string) ?? ''
      }),
      createSetuBlock(registry.blocks, blockCores),
      Passthrough,
      Image,
      ImageBlock,
      SlashCommand,
      LinkTools.configure({
        onEdit: (ed) => {
          ed.chain().focus().extendMarkRange('link').run()
          // Open the URL field directly (not just the bubble): defer so the bubble
          // has mounted + subscribed to onRequestLinkEdit after the selection change.
          setTimeout(() => requestLinkEdit(), 0)
        }
      })
    ],
    content: initialContent,
    editorProps: {
      attributes: { class: 'setu-prose', 'aria-label': 'Content editor' }
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as TiptapDoc)
  })
  editorRef.current = editor

  useEffect(() => {
    onEditor?.(editor)
    return () => onEditor?.(null)
  }, [editor, onEditor])

  const [imgBusy, setImgBusy] = useState(false)
  // The pending pick handler: insert (slash /image) or replace (in-block button)
  // both open the same modal; the chosen src is routed to whichever set this.
  const [pendingPick, setPendingPick] = useState<
    ((src: string) => void) | null
  >(null)
  const apiBase = (import.meta.env.VITE_SETU_API as string) ?? ''
  useEffect(() => {
    if (!editor) return
    const s = editor.storage as unknown as {
      image: {
        onUploading?: (b: boolean) => void
        onError?: (m: string) => void
      }
      imageBlock: {
        apiBase: string
        onUploading?: (b: boolean) => void
        onError?: (m: string) => void
        openPicker?: (onPick: (src: string) => void) => void
      }
    }
    const onUploading = (busy: boolean) => {
      setImgBusy(busy)
    }
    const onError = (msg: string) => notify.error(msg)
    s.image.onUploading = onUploading
    s.image.onError = onError
    s.imageBlock.apiBase = apiBase
    s.imageBlock.onUploading = onUploading
    s.imageBlock.onError = onError
    s.imageBlock.openPicker = (onPick) => setPendingPick(() => onPick)
  }, [editor, apiBase, notify])

  return (
    <>
      {imgBusy && <div className="editor-banner">Uploading image…</div>}
      <EditorContent editor={editor} />
      {editor && <FormatBubble editor={editor} />}
      {editor && <TableMenu editor={editor} />}
      {editor && (
        <MediaPickerModal
          apiBase={apiBase}
          open={pendingPick !== null}
          onClose={() => setPendingPick(null)}
          onPick={(src) => {
            pendingPick?.(src)
            setPendingPick(null)
          }}
        />
      )}
    </>
  )
}

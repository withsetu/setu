import type { Editor } from '@tiptap/core'

/** True when a keyboard event is the Escape key. Pure. */
export function isEscape(e: KeyboardEvent): boolean {
  return e.key === 'Escape'
}

/** Esc behavior for the format bubble: collapse a non-empty text selection to a
 *  caret at its end (which makes the BubbleMenu's `shouldShow` go false → the bubble
 *  hides), keeping focus in the editor. Returns true if it collapsed something
 *  (handled), false when the selection was already empty (let Esc fall through). */
export function collapseSelectionOnEscape(editor: Editor): boolean {
  const { selection } = editor.state
  if (selection.empty) return false
  return editor.chain().focus().setTextSelection(selection.to).run()
}

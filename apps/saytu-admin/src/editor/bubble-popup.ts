import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

let openCount = 0

/** True while a popup INSIDE the format bubble (the Turn-into menu or the link URL
 *  input) is open. The bubble's document-level Esc handler defers to the popup's own
 *  Esc when this is set, so one Esc closes only the popup — not the whole selection.
 *  Needed because React 18 synthetic `stopPropagation` can't stop the bubble's native
 *  `document` keydown listener, so the bubble must defer via this shared flag. */
export function isBubblePopupOpen(): boolean {
  return openCount > 0
}

/** Register an open bubble popup; call the returned fn once to unregister (idempotent). */
export function registerBubblePopup(): () => void {
  openCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    openCount -= 1
  }
}

/** Whether a document-level Escape should collapse the selection to dismiss the
 *  format bubble: only when no inner popup is open AND there's a non-empty text
 *  selection. */
export function bubbleEscapeShouldCollapse(editor: Editor): boolean {
  if (isBubblePopupOpen()) return false
  const sel = editor.state.selection
  return sel instanceof TextSelection && !sel.empty
}

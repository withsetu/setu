import type { Editor } from '@tiptap/core'
import tippy from 'tippy.js'
import type { Instance as TippyInstance } from 'tippy.js'

/** How long a hint stays up. Long enough to read six words, short enough that it is
 *  gone before it can be in the way of the next keystroke. */
const HINT_MS = 2200

let current: TippyInstance | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/** Take down the hint that is showing, if any. Idempotent. */
export function dismissCaretHint(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  current?.destroy()
  current = null
}

/** Show a small transient note at the caret — the editor's quietest way of saying why
 *  a keystroke did nothing. Deliberately NOT `useNotify()`: a toast is the register for
 *  something that happened to the author's document, it lands in the corner away from
 *  where they are looking, and four of them stack up if a routine keystroke is pressed
 *  four times (`MAX_VISIBLE` in ui/notify.tsx). This reuses the editor's existing
 *  tippy + `theme: 'setu'` surface (the same one Tooltip.tsx and the shortcut hints
 *  use), so it inherits the light/dark token pair and adds no new CSS.
 *
 *  Only one hint exists at a time; a second call replaces the first rather than
 *  stacking — intended, and exercised by the repeat-press path in
 *  apps/admin/test-browser/heading-single-line.test.tsx.
 *
 *  The message is written into the element AFTER it is mounted, because a live region
 *  that is inserted with its text already in it is not reliably announced — the text
 *  has to change while the region is in the document. */
export function showCaretHint(editor: Editor, message: string): void {
  dismissCaretHint()
  const el = document.createElement('span')
  el.setAttribute('role', 'status')
  const { head } = editor.state.selection
  const at = editor.view.coordsAtPos(head)
  current = tippy(document.body, {
    getReferenceClientRect: () =>
      new DOMRect(at.left, at.top, 0, at.bottom - at.top),
    appendTo: () => document.body,
    content: el,
    showOnCreate: true,
    interactive: false,
    trigger: 'manual',
    placement: 'top',
    // tippy's base CSS isn't loaded (codebase convention); the 'setu' theme styles the
    // box but would leave the arrow element unstyled — so disable it (as Tooltip does).
    arrow: false,
    theme: 'setu'
  })
  setTimeout(() => {
    el.textContent = message
  }, 0)
  timer = setTimeout(dismissCaretHint, HINT_MS)
}

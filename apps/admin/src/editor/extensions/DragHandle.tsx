import { Extension } from '@tiptap/core'
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection
} from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { moveBlock } from '../block-reorder'

export const dragHandleKey = new PluginKey('setuDragHandle')

/** Insertion slot for a pointer at `y`: the index of the gap the block should drop
 *  into — `i` for the top half of block `i`, `i+1` for its bottom half, and
 *  `tops.length` past the end. Range `[0, tops.length]`. Pure — unit-tested. */
export function dropTargetIndex(
  tops: number[],
  height: number,
  y: number
): number {
  if (tops.length === 0) return 0
  for (let i = 0; i < tops.length; i += 1) {
    const top = tops[i]!
    if (y < top + height / 2) return i
    if (y < top + height) return i + 1
  }
  return tops.length
}

/** Convert a drop (coords + source index) into the `moveBlock` target FINAL index.
 *  Removing the source shifts later slots left by one, so a slot past the source
 *  maps to slot-1. Dropping on the source's own gaps yields the source index
 *  (a no-op move). Pure — unit-tested. */
export function dropToIndex(
  tops: number[],
  height: number,
  y: number,
  fromIndex: number
): number {
  const slot = dropTargetIndex(tops, height, y)
  return slot > fromIndex ? slot - 1 : slot
}

/** Index of the top-level block whose vertical span contains `clientY`. */
function blockIndexAtY(view: EditorView, clientY: number): number | null {
  const doc = view.state.doc
  let best: number | null = null
  let pos = 0
  for (let i = 0; i < doc.childCount; i += 1) {
    const node = doc.child(i)
    const dom = view.nodeDOM(pos)
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect()
      if (clientY >= rect.top && clientY <= rect.bottom) {
        best = i
        break
      }
      if (clientY < rect.top && best === null) best = i
    }
    pos += node.nodeSize
  }
  return best
}

/** Reorder: move the dragged block (`fromIndex`) to wherever `clientY` points.
 *  Derives the target purely from the pointer Y + the blocks' rects, so a drop
 *  anywhere on the page (the gutter, not just over content) reorders correctly. */
function performBlockDrop(
  view: EditorView,
  fromIndex: number,
  clientY: number
): void {
  const tops: number[] = []
  let pos = 0
  let height = 20
  for (let i = 0; i < view.state.doc.childCount; i += 1) {
    const dom = view.nodeDOM(pos)
    if (dom instanceof HTMLElement) {
      const r = dom.getBoundingClientRect()
      tops.push(r.top)
      height = r.height || height
    }
    pos += view.state.doc.child(i).nodeSize
  }
  const toIndex = dropToIndex(tops, height, clientY, fromIndex)
  const tr = view.state.tr
  if (moveBlock(view.state.doc, tr, fromIndex, toIndex)) view.dispatch(tr)
}

interface DragHandleOptions {
  onMenu?: (view: EditorView, index: number, anchor: HTMLElement) => void
}

/** A grip in the left gutter that follows the hovered top-level block, drags to
 *  reorder, and opens the block menu (set via `onMenu`). Own plugin — no yjs. */
export const DragHandle = Extension.create<DragHandleOptions>({
  name: 'setuDragHandle',

  addOptions() {
    return { onMenu: undefined }
  },

  addProseMirrorPlugins() {
    const options = this.options
    let grip: HTMLButtonElement | null = null
    let hoverIndex: number | null = null

    return [
      new Plugin({
        key: dragHandleKey,
        view(view) {
          grip = document.createElement('button')
          grip.type = 'button'
          grip.className = 'blk-grip'
          grip.setAttribute('aria-label', 'Block actions')
          grip.setAttribute('draggable', 'true')
          grip.textContent = '⋮⋮'
          grip.style.position = 'absolute'
          grip.style.display = 'none'
          // The grip is absolutely positioned and `mousemove` sets its `top`
          // relative to this mount parent's rect — so the mount parent must BE the
          // offset parent. Tiptap's EditorContent wrapper is `position: static` by
          // default, which would make the grip resolve against `.ed-canvas` instead
          // and render ~100px too high. Force it relative.
          const mount = view.dom.parentElement
          if (mount) {
            mount.style.position = 'relative'
            mount.appendChild(grip)
          }

          const openMenu = () => {
            if (
              hoverIndex === null ||
              grip === null ||
              options.onMenu === undefined
            )
              return
            let pos = 0
            for (let i = 0; i < hoverIndex; i += 1)
              pos += view.state.doc.child(i).nodeSize
            const node = view.state.doc.child(hoverIndex)
            const tr = view.state.tr
            const sel = node.isAtom
              ? NodeSelection.create(view.state.doc, pos)
              : TextSelection.near(view.state.doc.resolve(pos + 1))
            tr.setSelection(sel)
            view.dispatch(tr)
            options.onMenu?.(view, hoverIndex, grip)
          }
          grip.addEventListener('click', openMenu)
          grip.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openMenu()
            }
          })
          grip.addEventListener('dragstart', (e) => {
            if (hoverIndex === null) return
            const fromIndex = hoverIndex
            e.dataTransfer?.setData(
              'application/x-setu-block',
              String(fromIndex)
            )
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
            // Handle the drop at the document level (capture phase) so releasing the
            // grip anywhere — the empty gutter included, not just over content —
            // reorders, and so ProseMirror's own drop handling never runs.
            const onDragOver = (ev: DragEvent) => {
              ev.preventDefault()
              if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
            }
            const cleanup = () => {
              document.removeEventListener('dragover', onDragOver, true)
              document.removeEventListener('drop', onDrop, true)
              document.removeEventListener('dragend', cleanup, true)
            }
            const onDrop = (ev: DragEvent) => {
              ev.preventDefault()
              ev.stopPropagation()
              performBlockDrop(view, fromIndex, ev.clientY)
              cleanup()
            }
            document.addEventListener('dragover', onDragOver, true)
            document.addEventListener('drop', onDrop, true)
            document.addEventListener('dragend', cleanup, true)
          })

          return {
            destroy() {
              grip?.remove()
              grip = null
            }
          }
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              const index = blockIndexAtY(view, event.clientY)
              hoverIndex = index
              if (grip === null) return false
              if (index === null) {
                grip.style.display = 'none'
                return false
              }
              let pos = 0
              for (let i = 0; i < index; i += 1)
                pos += view.state.doc.child(i).nodeSize
              const dom = view.nodeDOM(pos)
              if (dom instanceof HTMLElement) {
                grip.style.display = 'flex'
                // Measure against the grip's ACTUAL offset parent (whichever
                // ancestor is positioned) rather than assuming it's the editor
                // wrapper — keeps the grip aligned to the block regardless of the
                // surrounding layout. offsetParent is only valid once visible.
                const opTop =
                  (
                    grip.offsetParent as HTMLElement | null
                  )?.getBoundingClientRect().top ?? 0
                // Center the grip on the block's first text line (using the block's
                // own line-height + top padding) so it aligns with the text rather
                // than the block's very top edge.
                const cs = getComputedStyle(dom)
                const padTop = parseFloat(cs.paddingTop) || 0
                const lineH =
                  parseFloat(cs.lineHeight) ||
                  dom.getBoundingClientRect().height
                const gripH = grip.offsetHeight || 24
                const top =
                  dom.getBoundingClientRect().top -
                  opTop +
                  padTop +
                  lineH / 2 -
                  gripH / 2
                grip.style.top = `${top}px`
                grip.style.left = '0px'
              }
              return false
            }
          }
        }
      })
    ]
  }
})

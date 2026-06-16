import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { moveBlock } from '../block-reorder'

export const dragHandleKey = new PluginKey('saytuDragHandle')

/** Insertion slot for a pointer at `y`: the index of the gap the block should drop
 *  into — `i` for the top half of block `i`, `i+1` for its bottom half, and
 *  `tops.length` past the end. Range `[0, tops.length]`. Pure — unit-tested. */
export function dropTargetIndex(tops: number[], height: number, y: number): number {
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
export function dropToIndex(tops: number[], height: number, y: number, fromIndex: number): number {
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

interface DragHandleOptions {
  onMenu?: (view: EditorView, index: number, anchor: HTMLElement) => void
}

/** A grip in the left gutter that follows the hovered top-level block, drags to
 *  reorder, and opens the block menu (set via `onMenu`). Own plugin — no yjs. */
export const DragHandle = Extension.create<DragHandleOptions>({
  name: 'saytuDragHandle',

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
          view.dom.parentElement?.appendChild(grip)

          const openMenu = () => {
            if (hoverIndex === null || grip === null || options.onMenu === undefined) return
            let pos = 0
            for (let i = 0; i < hoverIndex; i += 1) pos += view.state.doc.child(i).nodeSize
            const tr = view.state.tr
            tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + 1)))
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
            e.dataTransfer?.setData('application/x-saytu-block', String(hoverIndex))
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
          })

          return {
            destroy() {
              grip?.remove()
              grip = null
            },
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
              for (let i = 0; i < index; i += 1) pos += view.state.doc.child(i).nodeSize
              const dom = view.nodeDOM(pos)
              const parent = view.dom.parentElement
              if (dom instanceof HTMLElement && parent) {
                const r = dom.getBoundingClientRect()
                const pr = parent.getBoundingClientRect()
                grip.style.display = 'flex'
                grip.style.top = `${r.top - pr.top}px`
                grip.style.left = '0px'
              }
              return false
            },
            drop(view, event) {
              const raw = event.dataTransfer?.getData('application/x-saytu-block')
              if (raw === undefined || raw === '') return false
              const fromIndex = Number(raw)
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
              const toIndex = dropToIndex(tops, height, event.clientY, fromIndex)
              event.preventDefault()
              const tr = view.state.tr
              if (moveBlock(view.state.doc, tr, fromIndex, toIndex)) view.dispatch(tr)
              return true
            },
          },
        },
      }),
    ]
  },
})

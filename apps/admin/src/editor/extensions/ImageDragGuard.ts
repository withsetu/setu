import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const imageDragGuardKey = new PluginKey('setuImageDragGuard')

/** Stops native `<img>` drags from corrupting the document (#384).
 *
 *  Grabbing an image ITSELF (not the drag handle) starts the browser's NATIVE
 *  image drag — not a ProseMirror node move. On drop, ProseMirror's default
 *  handler parses the dragged HTML through the generic `img[src]` rule into a
 *  phantom INLINE `image` node (no block controls, serialized as a markdown
 *  `![...]` with the RESOLVED admin-origin URL) while the source node stays put
 *  — a duplicate on every drag.
 *
 *  Two layers:
 *  1. `dragstart` inside the canvas on any `<img>` is cancelled at the source —
 *     node moves are the drag handle's job (its drop is handled at document
 *     capture and never reaches ProseMirror). Belt behind the node views' own
 *     `draggable={false}`, covering every current and future node view img.
 *  2. `handleDrop` no-ops drops whose drag started on an `<img>` anywhere in
 *     this document (e.g. panel thumbnails outside the canvas, like the
 *     featured-image preview). Origin is tracked via document-level listeners;
 *     drops carrying OS files and ProseMirror's own `moved` node drops are left
 *     to their existing paths, and external/cross-window drops (which never fire
 *     an in-document `dragstart`) keep today's behavior.
 */
export const ImageDragGuard = Extension.create({
  name: 'setuImageDragGuard',

  addProseMirrorPlugins() {
    // True while the drag in flight started on an <img> in THIS document.
    // Cleared on dragend/drop (normal drag teardown) and mouseup (a cancelled
    // dragstart never fires dragend, so the release click clears it instead —
    // the flag can never go stale across separate user gestures).
    let internalImageDrag = false

    return [
      new Plugin({
        key: imageDragGuardKey,
        view() {
          const onDragStart = (e: DragEvent) => {
            internalImageDrag = e.target instanceof HTMLImageElement
          }
          const clear = () => {
            internalImageDrag = false
          }
          document.addEventListener('dragstart', onDragStart, true)
          document.addEventListener('dragend', clear, true)
          document.addEventListener('mouseup', clear, true)
          return {
            destroy() {
              document.removeEventListener('dragstart', onDragStart, true)
              document.removeEventListener('dragend', clear, true)
              document.removeEventListener('mouseup', clear, true)
            }
          }
        },
        props: {
          handleDOMEvents: {
            dragstart(_view, event) {
              if (event.target instanceof HTMLImageElement) {
                event.preventDefault()
                return true
              }
              return false
            }
          },
          handleDrop(_view, event, _slice, moved) {
            if (moved) return false // a real ProseMirror node move
            if (event.dataTransfer?.files?.length) return false // OS file drop
            if (internalImageDrag) {
              internalImageDrag = false
              event.preventDefault()
              return true // swallow: never re-parse an in-app image into a phantom
            }
            return false
          }
        }
      })
    ]
  }
})

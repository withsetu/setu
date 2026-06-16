type Listener = () => void

function channel() {
  const listeners = new Set<Listener>()
  return {
    on(cb: Listener): () => void {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    emit(): void {
      for (const l of [...listeners]) l()
    },
  }
}

const linkEdit = channel()
const shortcuts = channel()

/** Subscribe to "open the link editor" requests (returns an unsubscribe fn). */
export const onRequestLinkEdit = linkEdit.on
/** Request the link editor be opened (fired by the Mod-k keymap). */
export const requestLinkEdit = linkEdit.emit
/** Subscribe to "open the shortcuts cheat sheet" requests. */
export const onRequestShortcuts = shortcuts.on
/** Request the shortcuts cheat sheet be opened (fired by Mod-/ or the ? button). */
export const requestShortcuts = shortcuts.emit

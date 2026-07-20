import { useEffect, useRef, useState } from 'react'

/**
 * Controlled-input state for a text field inside a React node view whose backing
 * value lives in the ProseMirror node's attributes.
 *
 * Why this exists (#691): Tiptap 3.28 batches React node-view re-renders onto a
 * microtask (the ReactRenderer "portal notifications" change — `queueMicrotask`
 * in `createContentComponent`). A plain `value={node.attrs…}` input is therefore
 * briefly stale between an edit and the deferred re-render. React reconciles the
 * DOM value back to that stale prop after the first `onChange`, so the *next*
 * synchronous change is a value-equal no-op and its `onChange` never fires — e.g.
 * typing a caption and then clearing it: the clear is swallowed and the sub-key is
 * never removed. (In 3.26.1 the portal re-rendered synchronously, so the input
 * stayed authoritative and this never surfaced.)
 *
 * Holding the field's value in local React state — updated synchronously in the
 * change handler — keeps the input authoritative independent of when the node view
 * re-renders. An effect re-syncs from the node when the external value changes
 * out-of-band (undo/redo, programmatic edits). The guard compares the incoming
 * external value against the last one we reconciled, so writing our own edit back
 * through the node does not clobber in-flight local input.
 */
export function useMirroredField(
  external: string,
  commit: (value: string) => void
): { value: string; onChange: (value: string) => void } {
  const [value, setValue] = useState(external)
  const lastExternal = useRef(external)
  useEffect(() => {
    if (external !== lastExternal.current) {
      lastExternal.current = external
      setValue(external)
    }
  }, [external])
  return {
    value,
    onChange: (next: string) => {
      lastExternal.current = next
      setValue(next)
      commit(next)
    }
  }
}

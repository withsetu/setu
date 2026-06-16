import { useEffect } from 'react'
import type { RefObject } from 'react'

/** Focus-independent dismissal for a transient popup/menu: while `active`, pressing
 *  Escape OR a pointerdown outside `ref` calls `onClose`. Uses document-level
 *  listeners so it works no matter where focus currently sits (unlike an element
 *  onKeyDown, which needs the element focused). */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
): void {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    const onPointer = (e: PointerEvent) => {
      const el = ref.current
      if (el && e.target instanceof Node && !el.contains(e.target)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [ref, onClose, active])
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/** Roving-tabindex keyboard nav for a `role="toolbar"`. Mark each focusable child
 *  with `data-toolbar-item`. Exactly one child is tabbable (tabIndex 0) at a time —
 *  the toolbar becomes a single Tab stop — and ←/→ (wrapping) + Home/End move which
 *  one, focusing it. Returns the container `ref` and an `onKeyDown` to spread on the
 *  toolbar element. (Esc is intentionally NOT handled here.) */
export function useToolbarRoving() {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  const items = useCallback(
    () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-toolbar-item]') ?? []),
    [],
  )

  // Sync tabIndex to the active index on every render (cheap; keeps a single tab stop).
  useEffect(() => {
    const els = items()
    const clamped = els.length === 0 ? 0 : Math.min(active, els.length - 1)
    els.forEach((el, i) => {
      el.tabIndex = i === clamped ? 0 : -1
    })
  })

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const els = items()
      if (els.length === 0) return
      const cur = els.findIndex((el) => el.tabIndex === 0)
      const at = cur < 0 ? 0 : cur
      let next: number | null = null
      if (e.key === 'ArrowRight') next = (at + 1) % els.length
      else if (e.key === 'ArrowLeft') next = (at - 1 + els.length) % els.length
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = els.length - 1
      if (next === null) return
      e.preventDefault()
      setActive(next)
      els[next]?.focus()
    },
    [items],
  )

  return { ref, onKeyDown }
}

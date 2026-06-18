import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import tippy from 'tippy.js'

/** Attaches a tippy tooltip (shows on hover AND keyboard focus) to its single child
 *  element. Uses a `display:contents` wrapper so it adds no layout box; targets the
 *  wrapped element directly. Destroys the instance on unmount. */
export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current?.firstElementChild
    if (!(el instanceof HTMLElement)) return
    const inst = tippy(el, {
      content,
      trigger: 'mouseenter focus',
      theme: 'setu',
      delay: [150, 0],
      placement: 'top',
      // tippy's base CSS isn't loaded (by codebase convention); the 'setu' theme
      // styles the box, but the arrow element would be unstyled — so disable it.
      arrow: false,
    })
    return () => inst.destroy()
  }, [content])
  return (
    <span ref={ref} style={{ display: 'contents' }}>
      {children}
    </span>
  )
}

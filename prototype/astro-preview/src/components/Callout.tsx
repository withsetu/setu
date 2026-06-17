import type { ReactNode } from 'react'

interface Props {
  type?: string
  title?: string
  children?: ReactNode
}

// The single React "visual core" — the ONE thing a component author writes.
// On the site it renders WITHOUT a client directive -> static HTML, zero JS.
// The same core is what the editor's Tiptap node view would wrap (write once).
export default function Callout({ type = 'info', title, children }: Props) {
  return (
    <aside className={`callout callout--${type}`} data-component="Callout.tsx">
      <span className="callout__icon" aria-hidden>💡</span>
      <div className="callout__body">
        {title ? <p className="callout__title">{title}</p> : null}
        {children}
      </div>
    </aside>
  )
}

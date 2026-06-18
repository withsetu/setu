import type { ReactNode } from 'react'

interface Props {
  type?: string
  title?: string
  children?: ReactNode
}

// The single React visual core — authored here for now; sub-project #2 extracts it to
// a shared package and makes the editor's node view reuse it. Editable regions (title,
// body) are injectable so the editor shell can later pass an <input> + <NodeViewContent>.
// No client directive on the site => static HTML, zero JS.
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

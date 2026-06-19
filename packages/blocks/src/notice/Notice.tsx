import type { ReactNode } from 'react'

export interface NoticeProps {
  /** CSS tone suffix: info | warn | success. */
  tone?: string
  /** Optional heading shown above the body. */
  title?: ReactNode
  /** The notice body. */
  children: ReactNode
}

/** The single notice visual core — rendered by BOTH the editor node view and the site
 *  wrapper (the callout pattern). Owns the structure + class contract. */
export function Notice({ tone = 'info', title, children }: NoticeProps) {
  return (
    <aside className={`notice notice-${tone}`}>
      {title ? <p className="notice-title">{title}</p> : null}
      <div className="notice-body">{children}</div>
    </aside>
  )
}

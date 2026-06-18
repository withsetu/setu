import type { ReactNode } from 'react'

export function PageHeader({
  title,
  count,
  subtitle,
  actions,
}: {
  title: string
  count?: number
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        <h1 className="page-title">
          {title}
          {count !== undefined && <span className="page-count">{count}</span>}
        </h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

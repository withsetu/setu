import { useEffect, type ReactNode } from 'react'
import { useSiteTitle } from '../data/settings-store'

export function PageHeader({
  title,
  count,
  subtitle,
  actions
}: {
  title: string
  count?: number
  subtitle?: string
  actions?: ReactNode
}) {
  const siteTitle = useSiteTitle()
  // Document title: "<Screen> - <Site Title> - Setu" (deduped when no site title is set).
  useEffect(() => {
    const product = 'Setu'
    document.title =
      siteTitle && siteTitle !== product
        ? `${title} - ${siteTitle} - ${product}`
        : `${title} - ${product}`
  }, [title, siteTitle])

  return (
    <header className="flex items-end justify-between gap-4 border-b border-border bg-background px-[30px] pt-[22px] pb-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-[21px] font-bold tracking-tight text-foreground">
          {title}
          {count !== undefined && (
            <span className="ml-2.5 align-[3px] rounded-full bg-secondary px-2 py-0.5 text-[13px] font-semibold text-muted-foreground">
              {count}
            </span>
          )}
        </h1>
        {subtitle && (
          <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-shrink-0 items-center gap-2.5">{actions}</div>
      )}
    </header>
  )
}

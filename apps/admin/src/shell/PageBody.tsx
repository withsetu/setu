import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The one content container: consistent gutters (aligned to the page header)
 *  so content doesn't touch the sidebar/edge, but fills the available width.
 *  Screens render their content inside this. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('px-[30px] pt-6 pb-10', className)}>
      {children}
    </div>
  )
}

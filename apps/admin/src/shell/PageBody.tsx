import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The one content container: consistent gutters (aligned to the page header),
 *  a max width so content doesn't sprawl on wide screens, left-aligned so it
 *  tracks the page title. Screens render their content inside this. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mx-0 max-w-[1400px] space-y-5 px-[30px] pt-6 pb-10', className)}>
      {children}
    </div>
  )
}

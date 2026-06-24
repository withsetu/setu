import type { Lifecycle } from '@setu/core'
import { Badge } from '@/components/ui/badge'
import { statusBadge } from '../lib/status-badge'
import { lifecycleLabel } from '../lifecycle/label'

/** Canonical lifecycle status for the editor strip — same variant mapping as the
 *  content lists (src/lib/status-badge), with the pending suffix. */
export function StripStatus({ lifecycle }: { lifecycle: Lifecycle }) {
  const { label, variant } = statusBadge(lifecycle)
  const { pending } = lifecycleLabel(lifecycle)
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={variant}>{label}</Badge>
      {pending && <span className="text-xs text-muted-foreground">· {pending}</span>}
    </span>
  )
}

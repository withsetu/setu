import type { Lifecycle } from '@setu/core'
import { lifecycleLabel } from '../lifecycle/label'

export type StatusVariant = 'warning' | 'info' | 'success' | 'secondary'

const STATE_VARIANT: Record<Lifecycle['state'], StatusVariant> = {
  draft: 'warning',
  staged: 'info',
  live: 'success',
  unpublished: 'secondary'
}

export function statusBadge(lc: Lifecycle): {
  label: string
  variant: StatusVariant
} {
  return { label: lifecycleLabel(lc).label, variant: STATE_VARIANT[lc.state] }
}

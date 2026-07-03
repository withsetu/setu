import type { Lifecycle } from '@setu/core'

const STATE_LABEL: Record<Lifecycle['state'], string> = {
  draft: 'Draft',
  staged: 'Staged',
  live: 'Live',
  unpublished: 'Unpublished'
}

export function lifecycleLabel(lc: Lifecycle): {
  label: string
  pending?: string
} {
  const label = STATE_LABEL[lc.state]
  return lc.pending ? { label, pending: lc.pending } : { label }
}

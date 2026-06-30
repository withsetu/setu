import type { ReprocessJobStore } from '@setu/core'

export function resumeActiveJob(store: ReprocessJobStore, run: (jobId: string) => void): void {
  const active = store.active()
  if (active) run(active.id)
}

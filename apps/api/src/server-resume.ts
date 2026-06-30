import type { ReprocessJobStore } from '@setu/core'

export function resumeActiveJob(store: ReprocessJobStore, run: (jobId: string) => void): void {
  // Best-effort: a corrupt/unreadable job DB must not take the server down on boot.
  try {
    const active = store.active()
    if (active) run(active.id)
  } catch (err) {
    console.warn(`reprocess: resume-on-boot skipped — ${err instanceof Error ? err.message : String(err)}`)
  }
}

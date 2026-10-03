import type { DeployJobStore, ReprocessJobStore } from '@setu/core'

export function resumeActiveJob(
  store: ReprocessJobStore,
  run: (jobId: string) => void
): void {
  // Best-effort: a corrupt/unreadable job DB must not take the server down on boot.
  try {
    const active = store.active()
    if (active) run(active.id)
  } catch (err) {
    console.warn(
      `reprocess: resume-on-boot skipped — ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/** The reason a deploy job left `running` by a previous api process is failed with (#1157).
 *  Operator prose: it reaches the admin as the job's error. Deliberately does NOT say "nothing
 *  was published": a signal-killed api runs no exit hook, so its build child can outlive it and
 *  finish writing output. What is certain is only that the deploy was not recorded. */
export const INTERRUPTED_BY_RESTART =
  'Interrupted by a server restart before the build finished, so this deploy was not recorded. Publish again to make sure your saved changes are live.'

/**
 * Fail every deploy job a previous api process left `running` (#1157). Call at boot, BEFORE the
 * deploy routes are mounted. A build is an in-process child of the api, so a `running` row seen
 * at boot belongs to a process that no longer exists: nothing will ever call `finish()` on it,
 * and the single-flight gate would refuse every later rebuild with 409. Unlike reprocess (which
 * resumes from a cursor) an `astro build` cannot be resumed, so the honest outcome is `failed`.
 *
 * Best-effort, like `resumeActiveJob`: a corrupt job DB must not take the server down on boot.
 * Bounded by remembering each id it has failed — a store whose `finish()` does not take would
 * otherwise spin here forever. Pinned by apps/api/test/deploy-boot-reconcile.test.ts.
 */
export function failInterruptedDeployJobs(
  store: DeployJobStore,
  now: () => number = () => Date.now()
): void {
  try {
    const failed = new Set<string>()
    for (let job = store.active(); job !== null; job = store.active()) {
      if (failed.has(job.id)) {
        console.warn(
          `deploy: job ${job.id} is still running after being failed at boot — giving up`
        )
        return
      }
      store.finish(job.id, 'failed', now(), { error: INTERRUPTED_BY_RESTART })
      failed.add(job.id)
    }
  } catch (err) {
    console.warn(
      `deploy: interrupted-job reconcile skipped — ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

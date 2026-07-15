/** Deploy job + state types (#207 epic, slice #208+#209). Mirrors the reprocess job
 *  pattern (reprocess/job.ts): core holds the types, @setu/db-sqlite the store, and the
 *  Node-only runner lives in apps/api — a build is a Node-topology capability.
 *
 *  Unlike reprocess there is no cursor/progress: an `astro build` is opaque — a job is
 *  running until the process exits, then done or failed (with the log tail for errors). */

/** Output mode the deploy produced. #211 (SSR/hybrid) extends this union — recorded
 *  from day one so the mode choice is a value change, not a schema migration. */
export type DeployMode = 'static'

export type DeployJobStatus = 'running' | 'done' | 'failed'

export interface DeployJob {
  id: string
  status: DeployJobStatus
  mode: DeployMode
  /** Git HEAD captured when the job started — what the build actually contains. */
  sha: string
  error?: string
  /** Tail of the build output, kept for failure display. */
  logTail?: string
  startedAt: number
  updatedAt: number
}

export interface DeployJobStore {
  create(sha: string, mode: DeployMode, now: number): DeployJob
  get(id: string): DeployJob | null
  /** The single running job, if any (single-flight is enforced by the API). */
  active(): DeployJob | null
  /** Most recent job by startedAt, any status (for status display). */
  latest(): DeployJob | null
  finish(
    id: string,
    status: 'done' | 'failed',
    now: number,
    opts?: { error?: string; logTail?: string }
  ): void
}

/** What "live" is: the last successfully deployed build. Persisted server-side
 *  (`.setu/deploy.json`) — the previous client-side snapshot reset on every reload. */
export interface DeployState {
  sha: string
  /** ISO timestamp of the successful deploy. */
  at: string
  mode: DeployMode
}

/** One path that differs between the deployed sha and HEAD. `added` distinguishes
 *  content that has never been on the live site (→ staged) from content that is live
 *  with newer changes pending (→ live · staged) — the honest per-entry state (#208). */
export interface ChangedPath {
  path: string
  added: boolean
}

/** `GET /api/deploy/status` response — the honest saved-vs-live picture (#208). */
export interface DeployStatus {
  deployedSha: string | null
  deployedAt: string | null
  headSha: string
  /** True when HEAD differs from the deployed sha (or nothing was ever deployed). */
  pending: boolean
  /** Paths changed since the deployed sha (empty when never deployed — everything is new). */
  changedPaths: ChangedPath[]
  job: DeployJob | null
  /** Whether this topology can run a rebuild (Node + site dir). The indicator above
   *  stays honest even where this is false. */
  canRebuild: boolean
}

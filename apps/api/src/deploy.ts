import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
import type {
  Action,
  Actor,
  ChangedPath,
  DeployJobStore,
  DeployState,
  DeployStatus
} from '@setu/core'
import { authMiddleware } from './auth/middleware'
import type { ResolveActor } from './auth/resolve-actor'
import { explainBuildFailure } from './build-failure'

const authz = createAuthz(DEFAULT_ROLES)

/** Why a rebuild can't run in a repo with no commits (#1158). Operator prose for the admin. */
const NO_COMMITS =
  'The content repository has no commits yet, so there is nothing saved to publish. Save something first, then publish.'

function requireCan(action: Action) {
  return createMiddleware<{ Variables: { actor: Actor } }>(async (c, next) => {
    if (!authz.can(c.get('actor'), action))
      return c.json({ error: 'forbidden' }, 403)
    await next()
  })
}

/** Deploy control plane (#207, slice #208+#209). Replaces the client-side deploy
 *  simulation (React state that reset on reload) with server-side truth:
 *
 *  - `GET  /api/deploy/status` — the honest saved-vs-live picture: last deployed
 *    sha/time vs Git HEAD, plus the changed paths in between (#208). Works on every
 *    topology that can read the repo, even where rebuild can't run.
 *  - `POST /api/deploy/rebuild` — runs the site build as an async single-flight job
 *    and records the deploy on success (#209). Capability-gated: only offered where
 *    a site dir is configured (Node topologies). Edge deploy is #210 (needs #141).
 *
 *  Both gated `site.deploy` (Maintainer+/Admin). All effectful seams are injected
 *  (state file, git lookups, the build itself) so tests never spawn processes; the
 *  real wiring lives in server.ts. Mode-aware: jobs and the deploy record carry a
 *  `mode` ('static' today) so #211's SSR/hybrid choice extends a value, not a schema. */
export function createDeployApi(opts: {
  resolveActor: ResolveActor
  /** Astro project dir, or null when this deployment cannot build (capability off). */
  siteDir: string | null
  jobs: DeployJobStore
  readState: () => DeployState | null
  writeState: (s: DeployState) => void
  headSha: () => Promise<string>
  /** Paths changed between the deployed sha and HEAD (`git diff --name-status`),
   *  with `added` marking content that has never been on the live site. */
  changedPaths: (sinceSha: string) => Promise<ChangedPath[]>
  /** Runs the actual build; resolves on success, rejects on failure. */
  runBuild: () => Promise<void>
  /** Why a build must not run right now, or null when it may (#1087). Consulted PER REQUEST,
   *  not once at boot: what it reports is another process's lifetime, so a boot-time snapshot
   *  would keep refusing after that process exited. Omitted → never blocked, which is the
   *  behaviour every topology had before. */
  buildBlocked?: () => string | null
  now?: () => number
}) {
  const {
    resolveActor,
    siteDir,
    jobs,
    readState,
    writeState,
    headSha,
    changedPaths,
    runBuild,
    buildBlocked = () => null,
    now = () => Date.now()
  } = opts

  const app = new Hono<{ Variables: { actor: Actor } }>()
  const auth = authMiddleware(resolveActor)
  const canDeploy = requireCan('site.deploy')

  /** HEAD, or null when the repo has no commits (`git rev-parse HEAD` exits 128) — there is
   *  nothing saved to build. Any lookup failure lands here: the status route must answer, not
   *  500, or the admin loses the very control that would recover (#1158).
   *  Pinned by apps/api/test/deploy.test.ts. */
  async function resolveHead(): Promise<string | null> {
    try {
      return await headSha()
    } catch (err) {
      console.warn(
        `[deploy] HEAD unresolvable — ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }
  }

  app.get('/api/deploy/status', auth, canDeploy, async (c) => {
    // Job and deploy record read together, before any await: a build finishing while this
    // request waits on git would otherwise pair a `done` job with the PREVIOUS deploy record,
    // and the admin's final poll would keep showing the stale baseline after a success.
    // rebuild's success path finishes the job and writes the record in one synchronous step,
    // so two synchronous reads here always see both or neither.
    // Pinned by apps/api/test/deploy.test.ts ("a build finishing mid-request").
    const job = jobs.active() ?? jobs.latest()
    const state = readState()
    const head = await resolveHead()
    const blocked =
      siteDir === null ? null : head === null ? NO_COMMITS : buildBlocked()
    let changed: ChangedPath[] = []
    // A recorded deploy we cannot diff against: its sha is not in the repo (history
    // rewritten, repo re-cloned) or there is no HEAD at all. Nothing is then KNOWN to be live,
    // so this reports pending with an explicit flag rather than an empty "nothing pending"
    // list, and keeps rebuild offered — a successful build re-baselines (#1158).
    let baselineUnresolvable = state !== null && head === null
    if (state !== null && head !== null && state.sha !== head) {
      try {
        changed = await changedPaths(state.sha)
      } catch (err) {
        console.warn(
          `[deploy] deployed sha ${state.sha} is not diffable against HEAD — ${err instanceof Error ? err.message : String(err)}`
        )
        baselineUnresolvable = true
      }
    }
    const status: DeployStatus = {
      deployedSha: state?.sha ?? null,
      deployedAt: state?.at ?? null,
      headSha: head,
      pending: state === null || state.sha !== head,
      changedPaths: changed,
      baselineUnresolvable,
      job,
      // Both halves, so the control disables instead of offering a button that 409s
      // (CLAUDE.md §4 #13, read the other way round: the UI must not offer what the server
      // will refuse). `rebuildBlockedReason` carries the transient half only — a missing site
      // dir is a topology fact the UI already words for itself.
      canRebuild: siteDir !== null && blocked === null,
      rebuildBlockedReason: blocked
    }
    return c.json(status)
  })

  app.post('/api/deploy/rebuild', auth, canDeploy, async (c) => {
    if (siteDir === null)
      return c.json(
        {
          error:
            'Rebuild is not available in this deployment — no site directory is configured. On an edge topology the site rebuilds via your Git host/CI instead.'
        },
        409
      )
    // Checked before the single-flight gate and before any job row is created: a blocked
    // build must leave no trace, least of all a job the UI would poll.
    const blocked = buildBlocked()
    if (blocked !== null) return c.json({ error: blocked }, 409)
    if (jobs.active() !== null)
      return c.json({ error: 'A build is already running.' }, 409)

    const sha = await resolveHead()
    if (sha === null) return c.json({ error: NO_COMMITS }, 409)
    const job = jobs.create(sha, 'static', now())
    // Fire-and-forget: the build outlives this request; status is polled via GET.
    void runBuild()
      .then(() => {
        jobs.finish(job.id, 'done', now())
        writeState({ sha, at: new Date(now()).toISOString(), mode: 'static' })
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e)
        const rawTail =
          e instanceof Error && 'logTail' in e
            ? (e as { logTail?: unknown }).logTail
            : undefined
        const logTail = typeof rawTail === 'string' ? rawTail : undefined
        // A known, fixable cause in the tail is named up front (#1183); the raw tail is kept.
        jobs.finish(job.id, 'failed', now(), {
          error: explainBuildFailure(message, logTail),
          logTail
        })
      })
    return c.json({ job }, 202)
  })

  return app
}

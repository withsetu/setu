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

const authz = createAuthz(DEFAULT_ROLES)

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
    now = () => Date.now()
  } = opts

  const app = new Hono<{ Variables: { actor: Actor } }>()
  const auth = authMiddleware(resolveActor)
  const canDeploy = requireCan('site.deploy')

  app.get('/api/deploy/status', auth, canDeploy, async (c) => {
    const state = readState()
    const head = await headSha()
    const changed =
      state !== null && state.sha !== head ? await changedPaths(state.sha) : []
    const status: DeployStatus = {
      deployedSha: state?.sha ?? null,
      deployedAt: state?.at ?? null,
      headSha: head,
      pending: state === null || state.sha !== head,
      changedPaths: changed,
      job: jobs.active() ?? jobs.latest(),
      canRebuild: siteDir !== null
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
    if (jobs.active() !== null)
      return c.json({ error: 'A build is already running.' }, 409)

    const sha = await headSha()
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
        jobs.finish(job.id, 'failed', now(), { error: message, logTail })
      })
    return c.json({ job }, 202)
  })

  return app
}

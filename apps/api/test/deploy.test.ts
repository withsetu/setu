import { describe, it, expect, vi } from 'vitest'
import type { Actor, ChangedPath, DeployState, Role } from '@setu/core'
import { createSqliteDeployJobStore } from '@setu/db-sqlite'
import { createDeployApi } from '../src/deploy'
import type { ResolveActor } from '../src/auth/resolve-actor'

const asRole =
  (role: Role): ResolveActor =>
  () =>
    ({ id: 'u', role }) satisfies Actor
const unauthenticated: ResolveActor = () => null

/** In-memory stand-ins for the injectable seams (fs state file, git, build). */
function harness(opts?: {
  resolveActor?: ResolveActor
  siteDir?: string | null
  head?: string
  changed?: ChangedPath[]
  state?: DeployState | null
  build?: () => Promise<void>
}) {
  let state: DeployState | null = opts?.state ?? null
  const build = vi.fn(opts?.build ?? (async () => {}))
  const app = createDeployApi({
    resolveActor: opts?.resolveActor ?? asRole('admin'),
    siteDir: opts?.siteDir === undefined ? '/site' : opts.siteDir,
    jobs: createSqliteDeployJobStore(':memory:'),
    readState: () => state,
    writeState: (s) => {
      state = s
    },
    headSha: async () => opts?.head ?? 'head-sha',
    changedPaths: async (since) =>
      opts?.changed ?? [
        { path: `content/post/en/changed-since-${since}.mdoc`, added: false }
      ],
    runBuild: build,
    now: () => 1_000_000
  })
  return {
    app,
    build,
    getState: () => state,
    status: async () => {
      const r = await Promise.resolve(
        app.fetch(new Request('http://x/api/deploy/status'))
      )
      return {
        code: r.status,
        body: (await r.json()) as Record<string, unknown>
      }
    },
    rebuild: async () => {
      const r = await Promise.resolve(
        app.fetch(
          new Request('http://x/api/deploy/rebuild', { method: 'POST' })
        )
      )
      return {
        code: r.status,
        body: (await r.json()) as Record<string, unknown>
      }
    }
  }
}

describe('deploy api — authz gate (site.deploy: Maintainer+)', () => {
  it('401 unauthenticated, 403 for editor, 200 for maintainer', async () => {
    expect(
      (await harness({ resolveActor: unauthenticated }).status()).code
    ).toBe(401)
    expect(
      (await harness({ resolveActor: asRole('editor') }).status()).code
    ).toBe(403)
    expect(
      (await harness({ resolveActor: asRole('maintainer') }).status()).code
    ).toBe(200)
    expect(
      (await harness({ resolveActor: asRole('editor') }).rebuild()).code
    ).toBe(403)
  })
})

describe('deploy api — status (the honest indicator, #208)', () => {
  it('never deployed: pending with no changed-path list (everything is new)', async () => {
    const { status } = harness({ state: null })
    const { code, body } = await status()
    expect(code).toBe(200)
    expect(body.deployedSha).toBeNull()
    expect(body.pending).toBe(true)
    expect(body.changedPaths).toEqual([])
  })

  it('deployed and HEAD unchanged: not pending', async () => {
    const { status } = harness({
      state: { sha: 'head-sha', at: '2026-07-09T00:00:00Z', mode: 'static' },
      head: 'head-sha',
      changed: []
    })
    const { body } = await status()
    expect(body.pending).toBe(false)
    expect(body.deployedSha).toBe('head-sha')
  })

  it('deployed and HEAD moved: pending with the changed paths since the deployed sha', async () => {
    const { status } = harness({
      state: { sha: 'old-sha', at: '2026-07-09T00:00:00Z', mode: 'static' },
      head: 'new-sha',
      changed: [
        { path: 'content/post/en/a.mdoc', added: false },
        { path: 'content/post/en/brand-new.mdoc', added: true },
        { path: 'settings.json', added: false }
      ]
    })
    const { body } = await status()
    expect(body.pending).toBe(true)
    expect(body.changedPaths).toEqual([
      { path: 'content/post/en/a.mdoc', added: false },
      { path: 'content/post/en/brand-new.mdoc', added: true },
      { path: 'settings.json', added: false }
    ])
  })
})

describe('deploy api — rebuild (#209)', () => {
  it('starts an async job, then records the deployed sha+mode on success', async () => {
    let resolveBuild!: () => void
    const gate = new Promise<void>((r) => (resolveBuild = r))
    const h = harness({ head: 'sha-at-start', build: () => gate })

    const { code, body } = await h.rebuild()
    expect(code).toBe(202)
    const job = body.job as { id: string; status: string; sha: string }
    expect(job.status).toBe('running')
    expect(job.sha).toBe('sha-at-start')
    expect(h.getState()).toBeNull() // not recorded until the build finishes

    resolveBuild()
    await vi.waitFor(async () => {
      const { body: s } = await h.status()
      expect((s.job as { status: string }).status).toBe('done')
    })
    expect(h.getState()).toEqual({
      sha: 'sha-at-start',
      at: new Date(1_000_000).toISOString(),
      mode: 'static'
    })
  })

  it('a failing build marks the job failed and does NOT record a deploy', async () => {
    const h = harness({
      build: async () => {
        throw new Error('astro build exited 1')
      }
    })
    await h.rebuild()
    await vi.waitFor(async () => {
      const { body: s } = await h.status()
      expect((s.job as { status: string }).status).toBe('failed')
    })
    expect(h.getState()).toBeNull()
  })

  it('409 when a build is already running (single-flight)', async () => {
    let resolveBuild!: () => void
    const gate = new Promise<void>((r) => (resolveBuild = r))
    const h = harness({ build: () => gate })
    expect((await h.rebuild()).code).toBe(202)
    expect((await h.rebuild()).code).toBe(409)
    resolveBuild()
  })

  it('409 with an honest message when the topology cannot build (no site dir)', async () => {
    const h = harness({ siteDir: null })
    const { code, body } = await h.rebuild()
    expect(code).toBe(409)
    expect(String(body.error)).toMatch(/not available/i)
    // status still works — the indicator is honest even where rebuild is impossible
    expect((await h.status()).code).toBe(200)
  })
})

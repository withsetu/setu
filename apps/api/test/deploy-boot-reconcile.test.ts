import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Actor, DeployJobStore } from '@setu/core'
import { createSqliteDeployJobStore } from '@setu/db-sqlite'
import { createDeployApi } from '../src/deploy'
import {
  INTERRUPTED_BY_RESTART,
  failInterruptedDeployJobs
} from '../src/server-resume'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'setu-deployjobs-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function apiOver(jobs: DeployJobStore) {
  return createDeployApi({
    resolveActor: () => ({ id: 'u', role: 'admin' }) satisfies Actor,
    siteDir: '/site',
    jobs,
    readState: () => null,
    writeState: () => {},
    headSha: async () => 'head',
    changedPaths: async () => [],
    runBuild: () => new Promise<void>(() => {}),
    now: () => 5_000
  })
}

const post = (app: ReturnType<typeof apiOver>) =>
  Promise.resolve(
    app.fetch(new Request('http://x/api/deploy/rebuild', { method: 'POST' }))
  )

describe('deploy jobs left running by a previous process (#1157)', () => {
  it('a reopened store file with a running row is failed at boot, and rebuild works again', async () => {
    const file = join(dir, 'deploy-jobs.db')
    // The previous process: a build started, then the api died before finish().
    const before = createSqliteDeployJobStore(file)
    const stuck = before.create('sha-1', 'static', 1_000)
    // Precondition — without the reconcile this is the bug: rebuild refuses forever.
    expect((await post(apiOver(createSqliteDeployJobStore(file)))).status).toBe(
      409
    )

    // The next boot.
    const after = createSqliteDeployJobStore(file)
    failInterruptedDeployJobs(after, () => 9_000)

    expect(after.active()).toBeNull()
    const job = after.get(stuck.id)
    expect(job?.status).toBe('failed')
    expect(job?.error).toBe(INTERRUPTED_BY_RESTART)
    expect(job?.updatedAt).toBe(9_000)
    expect((await post(apiOver(after))).status).toBe(202)
  })

  it('leaves finished jobs untouched', () => {
    const s = createSqliteDeployJobStore(join(dir, 'd.db'))
    const done = s.create('a', 'static', 1)
    s.finish(done.id, 'done', 2)
    const failed = s.create('b', 'static', 3)
    s.finish(failed.id, 'failed', 4, { error: 'build exited with code 1' })
    failInterruptedDeployJobs(s, () => 99)
    expect(s.get(done.id)).toMatchObject({ status: 'done', updatedAt: 2 })
    expect(s.get(failed.id)).toMatchObject({
      status: 'failed',
      error: 'build exited with code 1',
      updatedAt: 4
    })
  })

  it('fails every running row, not just the newest', () => {
    const s = createSqliteDeployJobStore(join(dir, 'd.db'))
    const a = s.create('a', 'static', 1)
    const b = s.create('b', 'static', 2)
    failInterruptedDeployJobs(s, () => 99)
    expect(s.get(a.id)?.status).toBe('failed')
    expect(s.get(b.id)?.status).toBe('failed')
  })

  it('a store fault cannot take boot down', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = {
      active: () => {
        throw new Error('db corrupt')
      }
    } as unknown as DeployJobStore
    expect(() => failInterruptedDeployJobs(broken, () => 1)).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('stops on a store whose finish() does not take, rather than spinning at boot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const finish = vi.fn()
    const sticky = {
      active: () => ({ id: 'j' }),
      finish
    } as unknown as DeployJobStore
    failInterruptedDeployJobs(sticky, () => 1)
    expect(finish.mock.calls.length).toBeLessThan(1000)
    warn.mockRestore()
  })
})

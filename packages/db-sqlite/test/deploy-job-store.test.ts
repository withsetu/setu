import { describe, it, expect } from 'vitest'
import { createSqliteDeployJobStore } from '../src/deploy-job-store'

describe('sqlite deploy job store', () => {
  it('creates, reads, and finishes a job; tracks active/latest', () => {
    const s = createSqliteDeployJobStore(':memory:')
    expect(s.active()).toBeNull()
    expect(s.latest()).toBeNull()

    const j = s.create('abc1234', 'static', 1000)
    expect(j.status).toBe('running')
    expect(j.mode).toBe('static')
    expect(j.sha).toBe('abc1234')
    expect(s.active()?.id).toBe(j.id)

    s.finish(j.id, 'done', 1005)
    expect(s.get(j.id)?.status).toBe('done')
    expect(s.active()).toBeNull()
    expect(s.latest()?.id).toBe(j.id)
  })

  it('records error and log tail on failure', () => {
    const s = createSqliteDeployJobStore(':memory:')
    const j = s.create('abc1234', 'static', 1000)
    s.finish(j.id, 'failed', 1005, {
      error: 'astro build exited 1',
      logTail: 'Error: kaboom\n  at src/pages/index.astro'
    })
    const done = s.get(j.id)
    expect(done?.status).toBe('failed')
    expect(done?.error).toBe('astro build exited 1')
    expect(done?.logTail).toContain('kaboom')
  })

  it('active() returns only a running job, latest() the most recent by startedAt', () => {
    const s = createSqliteDeployJobStore(':memory:')
    const a = s.create('sha-a', 'static', 1000)
    s.finish(a.id, 'done', 1001)
    const b = s.create('sha-b', 'static', 2000)
    expect(s.active()?.id).toBe(b.id)
    expect(s.latest()?.id).toBe(b.id)
    s.finish(b.id, 'failed', 2001, { error: 'x' })
    expect(s.active()).toBeNull()
    expect(s.latest()?.id).toBe(b.id)
  })
})

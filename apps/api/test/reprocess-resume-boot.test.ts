import { describe, it, expect, vi } from 'vitest'
import { resumeActiveJob } from '../src/server-resume'

describe('resume on boot', () => {
  it('runs the active job if one was left running', () => {
    const run = vi.fn()
    const store = { active: () => ({ id: 'j1' }) } as any
    resumeActiveJob(store, run)
    expect(run).toHaveBeenCalledWith('j1')
  })
  it('does nothing when no active job', () => {
    const run = vi.fn()
    resumeActiveJob({ active: () => null } as any, run)
    expect(run).not.toHaveBeenCalled()
  })
})

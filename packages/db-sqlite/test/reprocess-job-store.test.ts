import { describe, it, expect } from 'vitest'
import { createSqliteReprocessJobStore } from '../src/reprocess-job-store'

describe('sqlite reprocess job store', () => {
  it('creates, reads, advances, and finishes a job; tracks active/latest', () => {
    const s = createSqliteReprocessJobStore(':memory:')
    expect(s.active()).toBeNull()
    const j = s.create(['a.manifest.json', 'b.manifest.json'], 1000)
    expect(j.status).toBe('running'); expect(j.total).toBe(2); expect(j.cursor).toBe(0)
    expect(s.active()?.id).toBe(j.id)
    s.saveProgress(j.id, 1, 1, 1001)
    expect(s.get(j.id)?.processed).toBe(1)
    expect(s.get(j.id)?.cursor).toBe(1)
    s.finish(j.id, 'done', 1002)
    expect(s.get(j.id)?.status).toBe('done')
    expect(s.active()).toBeNull()              // no longer running
    expect(s.latest()?.id).toBe(j.id)          // still the latest for status display
    expect(s.get(j.id)?.keys).toEqual(['a.manifest.json', 'b.manifest.json'])
  })
})

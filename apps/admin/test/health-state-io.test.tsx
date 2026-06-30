import { describe, it, expect } from 'vitest'
import { createMemoryGitPort } from '@setu/git-memory'
import { loadHealthState, writeHealthRecord } from '../src/health/health-state'

describe('health-state IO', () => {
  it('writes a record and reads it back', async () => {
    const git = createMemoryGitPort([])
    await writeHealthRecord(git, 'item', 'privacy.policy', { state: 'attested', at: '2026-01-01', by: 'Local' })
    const state = await loadHealthState(git)
    expect(state.items['privacy.policy']?.state).toBe('attested')
  })
  it('preserves other records when updating one', async () => {
    const git = createMemoryGitPort([])
    await writeHealthRecord(git, 'item', 'a', { state: 'na', at: '2026-01-01', by: 'Local' })
    await writeHealthRecord(git, 'section', 'i18n', { state: 'na', at: '2026-01-01', by: 'Local' })
    await writeHealthRecord(git, 'item', 'a', null) // clear
    const state = await loadHealthState(git)
    expect(state.items.a).toBeUndefined()
    expect(state.sections.i18n?.state).toBe('na')
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildOwnerSequence,
  demoUserSpecs,
  isDraft,
  ROLE_WEIGHT
} from '../../src/engine/partition'

describe('demoUserSpecs', () => {
  it('expands per-role counts into deterministic identities', () => {
    const specs = demoUserSpecs({ admin: 1, author: 2 })
    expect(specs).toEqual([
      {
        email: 'demo-admin-1@demo.setu.test',
        name: 'Demo Admin 1',
        role: 'admin'
      },
      {
        email: 'demo-author-1@demo.setu.test',
        name: 'Demo Author 1',
        role: 'author'
      },
      {
        email: 'demo-author-2@demo.setu.test',
        name: 'Demo Author 2',
        role: 'author'
      }
    ])
  })

  it('rejects negative and non-integer counts', () => {
    expect(() => demoUserSpecs({ editor: -1 })).toThrow('editor')
    expect(() => demoUserSpecs({ author: 1.5 })).toThrow('author')
  })
})

describe('buildOwnerSequence', () => {
  it('weights ownership by role — all four roles write', () => {
    const specs = demoUserSpecs({
      admin: 1,
      maintainer: 1,
      editor: 1,
      author: 1
    })
    const sequence = buildOwnerSequence(specs)
    const total = Object.values(ROLE_WEIGHT).reduce((a, b) => a + b, 0)
    expect(sequence.length).toBe(total)
    const byRole = new Map<string, number>()
    for (const user of sequence)
      byRole.set(user.role, (byRole.get(user.role) ?? 0) + 1)
    expect(byRole.get('author')).toBe(ROLE_WEIGHT.author)
    expect(byRole.get('editor')).toBe(ROLE_WEIGHT.editor)
    expect(byRole.get('maintainer')).toBe(ROLE_WEIGHT.maintainer)
    expect(byRole.get('admin')).toBe(ROLE_WEIGHT.admin)
  })

  it('interleaves owners instead of writing in blocks', () => {
    const specs = demoUserSpecs({ admin: 1, author: 1 })
    const sequence = buildOwnerSequence(specs)
    // First round-robin pass takes one slot from EVERY user.
    expect(new Set(sequence.slice(0, 2).map((u) => u.email)).size).toBe(2)
  })

  it('throws with no users (posts need an owner)', () => {
    expect(() => buildOwnerSequence([])).toThrow('at least one')
  })
})

describe('isDraft', () => {
  it('spreads exactly round(N*fraction) drafts over any prefix', () => {
    const n = 1000
    const fraction = 0.1
    let drafts = 0
    for (let i = 0; i < n; i++) if (isDraft(i, fraction)) drafts++
    expect(drafts).toBe(100)
    // Prefix-stable: the first 100 posts contain ~10 drafts, not 0 or 100.
    let prefixDrafts = 0
    for (let i = 0; i < 100; i++) if (isDraft(i, fraction)) prefixDrafts++
    expect(prefixDrafts).toBe(10)
  })

  it('handles the edges: 0 → never, 1 → always', () => {
    expect(isDraft(0, 0)).toBe(false)
    expect(isDraft(42, 0)).toBe(false)
    expect(isDraft(0, 1)).toBe(true)
    expect(isDraft(42, 1)).toBe(true)
  })
})

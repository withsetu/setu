import { describe, it, expect } from 'vitest'
import { ROLE_RANK, rankOf, outranks } from '../../src/authz/rank'
import type { Role } from '../../src/authz/types'

describe('ROLE_RANK (the #364 ladder)', () => {
  it('admin > maintainer > editor > author, exact values', () => {
    expect(ROLE_RANK).toEqual({
      admin: 4,
      maintainer: 3,
      editor: 2,
      author: 1
    } satisfies Record<Role, number>)
  })
})

describe('rankOf', () => {
  it('returns the ladder value for each known role', () => {
    expect(rankOf('admin')).toBe(4)
    expect(rankOf('maintainer')).toBe(3)
    expect(rankOf('editor')).toBe(2)
    expect(rankOf('author')).toBe(1)
  })

  it('returns 0 for an unknown role (fail closed) — e.g. the removed viewer role', () => {
    expect(rankOf('viewer')).toBe(0)
  })

  it('returns 0 for garbage/empty input', () => {
    expect(rankOf('')).toBe(0)
    expect(rankOf('not-a-role')).toBe(0)
  })
})

describe('outranks', () => {
  it('maintainer outranks editor', () => {
    expect(outranks('maintainer', 'editor')).toBe(true)
  })

  it('a role never outranks its own rank (strict >)', () => {
    expect(outranks('maintainer', 'maintainer')).toBe(false)
  })

  it('admin outranks maintainer', () => {
    expect(outranks('admin', 'maintainer')).toBe(true)
  })

  it('an unknown actor role never outranks anyone (fail closed)', () => {
    expect(outranks('viewer', 'author')).toBe(false)
    expect(outranks('garbage', 'editor')).toBe(false)
  })

  it('lower rank never outranks higher rank', () => {
    expect(outranks('author', 'editor')).toBe(false)
    expect(outranks('editor', 'maintainer')).toBe(false)
  })

  // Intentional: outranks() only compares the two rank numbers. An unknown TARGET
  // rank collapses to 0, and any known actor (rank > 0) outranks 0 by the strict
  // formula — so a known actor "outranks" an unknown/garbage target string here.
  // This is fine for pure rank ORDERING; it is NOT a fail-closed authorization
  // decision by itself. The server-side guard that consumes this must separately
  // reject unknown/unparseable target roles before ever asking "does X outrank Y"
  // (see the doc comment on `outranks` in rank.ts).
  it('a known admin "outranks" an unknown target role by the rank formula alone', () => {
    expect(outranks('admin', 'garbage')).toBe(true)
  })
})

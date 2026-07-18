import { describe, it, expect } from 'vitest'
import {
  ROLE_RANK,
  rankOf,
  outranks,
  parseRoleSet,
  canonicalRoleOf,
  isSingleKnownRole
} from '../../src/authz/rank'
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

// #630: better-auth persists a multi-role assignment as a comma-joined string
// (`parseRoles` in its admin plugin joins arrays with `,` before writing the row).
// Setu's contract is ONE role per user — enforced on the WRITE path — but every
// READ path stays comma-aware so an already-persisted multi-role row still
// resolves to a usable actor instead of 401ing its owner out of the whole API.
describe('parseRoleSet (#630)', () => {
  it('splits a comma-joined role string into components', () => {
    expect(parseRoleSet('admin,maintainer')).toEqual(['admin', 'maintainer'])
  })

  it('returns a single-element list for a plain role', () => {
    expect(parseRoleSet('editor')).toEqual(['editor'])
  })

  it('trims surrounding whitespace on each component', () => {
    expect(parseRoleSet('admin, maintainer ')).toEqual(['admin', 'maintainer'])
  })

  it('accepts an array shape defensively', () => {
    expect(parseRoleSet(['admin', 'author'])).toEqual(['admin', 'author'])
  })

  it('returns an empty list for empty/absent/garbage-typed input', () => {
    expect(parseRoleSet('')).toEqual([])
    expect(parseRoleSet(null)).toEqual([])
    expect(parseRoleSet(undefined)).toEqual([])
    expect(parseRoleSet(42)).toEqual([])
    expect(parseRoleSet(',,')).toEqual([])
  })
})

describe('canonicalRoleOf (#630)', () => {
  it('returns the role itself for a plain known role', () => {
    expect(canonicalRoleOf('maintainer')).toBe('maintainer')
  })

  it('returns the HIGHEST-ranked component of a comma-joined role set', () => {
    expect(canonicalRoleOf('maintainer,admin')).toBe('admin')
    expect(canonicalRoleOf('admin,maintainer')).toBe('admin')
    expect(canonicalRoleOf('author,editor')).toBe('editor')
  })

  it('ignores unknown components when at least one known role is present', () => {
    expect(canonicalRoleOf('subscriber,editor')).toBe('editor')
  })

  it('returns null when no component is a known staff role (fails closed)', () => {
    expect(canonicalRoleOf('subscriber')).toBeNull()
    expect(canonicalRoleOf('')).toBeNull()
    expect(canonicalRoleOf(null)).toBeNull()
    expect(canonicalRoleOf(undefined)).toBeNull()
  })
})

describe('isSingleKnownRole (#630)', () => {
  it('accepts exactly one known role', () => {
    for (const role of ['admin', 'maintainer', 'editor', 'author'])
      expect(isSingleKnownRole(role)).toBe(true)
  })

  it('rejects a multi-role set — Setu users hold exactly one role', () => {
    expect(isSingleKnownRole('admin,maintainer')).toBe(false)
    expect(isSingleKnownRole(['admin', 'maintainer'])).toBe(false)
    expect(isSingleKnownRole(['admin'])).toBe(true)
  })

  it('rejects unknown roles and non-string input (fails closed)', () => {
    expect(isSingleKnownRole('subscriber')).toBe(false)
    expect(isSingleKnownRole('')).toBe(false)
    expect(isSingleKnownRole(null)).toBe(false)
    expect(isSingleKnownRole(42)).toBe(false)
  })
})

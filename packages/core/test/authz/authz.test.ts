import { describe, it, expect } from 'vitest'
import { createAuthz, DEFAULT_ROLES } from '../../src/authz/authz'
import type { Action, Actor, Role } from '../../src/authz/types'

const authz = createAuthz(DEFAULT_ROLES)
const actor = (role: Role): Actor => ({ id: 'u', role })

// The approved role matrix (epic #359, finalized 2026-07-04). This table is the
// source of truth for #362 role-level enforcement: `✓` = allowed, everything not
// listed for a role is denied. Ownership (own/any) and rank-scoping are OUT of
// scope here (increments #363/#364) — the coarse, unscoped action form is used.
const MATRIX: Record<Role, Action[]> = {
  admin: [
    'content.view', 'content.create', 'content.edit', 'content.delete', 'content.publish', 'content.unpublish',
    'taxonomy.view', 'taxonomy.create', 'taxonomy.edit', 'taxonomy.delete',
    'media.view', 'media.upload', 'media.edit', 'media.delete',
    'forms.view', 'forms.manage',
    'sitehealth.view', 'site.deploy', 'theme.manage',
    'settings.view', 'settings.manage',
    'users.view', 'users.invite', 'users.setRole', 'users.disable', 'users.delete',
    'roles.manage',
  ],
  maintainer: [
    'content.view', 'content.create', 'content.edit', 'content.delete', 'content.publish', 'content.unpublish',
    'taxonomy.view', 'taxonomy.create', 'taxonomy.edit', 'taxonomy.delete',
    'media.view', 'media.upload', 'media.edit', 'media.delete',
    'forms.view', 'forms.manage',
    'sitehealth.view', 'site.deploy', 'theme.manage',
    'settings.view',
    'users.view', 'users.invite', 'users.setRole', 'users.disable',
    // NOT: settings.manage, users.delete, roles.manage — the four Admin-only levers.
  ],
  editor: [
    'content.view', 'content.create', 'content.edit', 'content.delete', 'content.publish', 'content.unpublish',
    'taxonomy.view', 'taxonomy.create', 'taxonomy.edit', 'taxonomy.delete',
    'media.view', 'media.upload', 'media.edit', 'media.delete',
    // No forms, site health, ops, config, or users.
  ],
  author: [
    // Coarse form: edit/delete are unscoped until ownership lands (#363). No publish.
    'content.view', 'content.create', 'content.edit', 'content.delete',
    'taxonomy.view', 'taxonomy.create',
    'media.view', 'media.upload', 'media.edit',
  ],
}

const ALL_ACTIONS: Action[] = [
  'content.view', 'content.create', 'content.edit', 'content.delete', 'content.publish', 'content.unpublish',
  'taxonomy.view', 'taxonomy.create', 'taxonomy.edit', 'taxonomy.delete',
  'media.view', 'media.upload', 'media.edit', 'media.delete',
  'forms.view', 'forms.manage',
  'sitehealth.view', 'site.deploy', 'theme.manage',
  'settings.view', 'settings.manage',
  'users.view', 'users.invite', 'users.setRole', 'users.disable', 'users.delete',
  'roles.manage',
]

describe('DEFAULT_ROLES matrix (epic #359 approved table)', () => {
  for (const role of Object.keys(MATRIX) as Role[]) {
    const allowed = new Set(MATRIX[role])
    for (const action of ALL_ACTIONS) {
      const should = allowed.has(action)
      it(`${role} ${should ? 'CAN' : 'cannot'} ${action}`, () => {
        expect(authz.can(actor(role), action)).toBe(should)
      })
    }
  }
})

describe('the four Admin-only levers (everything else Maintainer can do)', () => {
  const adminOnly: Action[] = ['settings.manage', 'users.delete', 'roles.manage']
  for (const action of adminOnly) {
    it(`only admin has ${action}`, () => {
      expect(authz.can(actor('admin'), action)).toBe(true)
      expect(authz.can(actor('maintainer'), action)).toBe(false)
    })
  }
})

describe('the Forms-submissions PII gate (the #362 hole)', () => {
  it('admin and maintainer can view + manage form submissions', () => {
    for (const role of ['admin', 'maintainer'] as Role[]) {
      expect(authz.can(actor(role), 'forms.view')).toBe(true)
      expect(authz.can(actor(role), 'forms.manage')).toBe(true)
    }
  })
  it('editor and author cannot touch form submissions', () => {
    for (const role of ['editor', 'author'] as Role[]) {
      expect(authz.can(actor(role), 'forms.view')).toBe(false)
      expect(authz.can(actor(role), 'forms.manage')).toBe(false)
    }
  })
})

describe('content-write gate (the Git-write hole)', () => {
  // #379: with the read-only viewer role removed, every staff role holds content.edit — so the
  // Git-write denial now lives at the unauthenticated boundary (no actor → 401), asserted in
  // apps/api/test/git-authz.test.ts, not in the role matrix.
  it('every staff role can edit', () => {
    for (const role of ['admin', 'maintainer', 'editor', 'author'] as Role[]) {
      expect(authz.can(actor(role), 'content.edit')).toBe(true)
    }
  })
})

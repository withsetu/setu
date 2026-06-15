import { describe, it, expect } from 'vitest'
import { createAuthz, DEFAULT_ROLES } from '../../src/authz/authz'
import type { Actor } from '../../src/authz/types'

const authz = createAuthz(DEFAULT_ROLES)
const actor = (role: Actor['role']): Actor => ({ id: 'u', role })

describe('can', () => {
  it('owner can do everything', () => {
    expect(authz.can(actor('owner'), 'content.publish')).toBe(true)
    expect(authz.can(actor('owner'), 'site.deploy')).toBe(true)
    expect(authz.can(actor('owner'), 'roles.manage')).toBe(true)
  })
  it('editor can publish but not deploy or manage roles', () => {
    expect(authz.can(actor('editor'), 'content.publish')).toBe(true)
    expect(authz.can(actor('editor'), 'site.deploy')).toBe(false)
    expect(authz.can(actor('editor'), 'roles.manage')).toBe(false)
  })
  it('publisher can deploy', () => {
    expect(authz.can(actor('publisher'), 'site.deploy')).toBe(true)
  })
  it('viewer is read-only', () => {
    expect(authz.can(actor('viewer'), 'content.edit')).toBe(false)
    expect(authz.can(actor('viewer'), 'content.publish')).toBe(false)
  })
  it('author can edit but not publish', () => {
    expect(authz.can(actor('author'), 'content.edit')).toBe(true)
    expect(authz.can(actor('author'), 'content.publish')).toBe(false)
  })
  it('editor can unpublish', () => {
    expect(authz.can(actor('editor'), 'content.unpublish')).toBe(true)
  })
})

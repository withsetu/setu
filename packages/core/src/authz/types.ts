/** The permission vocabulary — granular, resource-scoped, role-level (epic #359).
 *
 *  Two later refinements layer on top of this coarse form and are intentionally
 *  NOT modelled here yet: ownership (`edit`/`delete` split into own vs any —
 *  increment #363, needs the author column #142) and rank-scoping (`users.*`
 *  constrained to below-rank — increment #364). Near-term enforcement uses the
 *  coarse/unscoped action below; per the epic that only over-trusts already-
 *  authenticated content staff, it is not a PII/authz hole. */
export type Action =
  // Content — posts & pages
  | 'content.view'
  | 'content.create'
  | 'content.edit'
  | 'content.delete'
  | 'content.publish'
  | 'content.unpublish'
  // Taxonomy — categories & tags
  | 'taxonomy.view'
  | 'taxonomy.create'
  | 'taxonomy.edit'
  | 'taxonomy.delete'
  // Media library
  | 'media.view'
  | 'media.upload'
  | 'media.edit'
  | 'media.delete'
  // Forms — submissions contain visitor PII
  | 'forms.view'
  | 'forms.manage'
  // Operations & configuration
  | 'sitehealth.view'
  | 'site.deploy'
  | 'theme.manage'
  | 'settings.view'
  | 'settings.manage'
  // Users & roles
  | 'users.view'
  | 'users.invite'
  | 'users.setRole'
  | 'users.disable'
  | 'users.delete'
  | 'roles.manage'

export type Role = 'admin' | 'maintainer' | 'editor' | 'author'

export interface Actor {
  id: string
  role: Role
}

/** Role → the set of actions it may perform. */
export type PermissionMatrix = Record<Role, ReadonlySet<Action>>

export interface Authz {
  can(actor: Actor, action: Action): boolean
}

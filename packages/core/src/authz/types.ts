/** The permission vocabulary. Flat + global for now (per-resource scoping later). */
export type Action =
  | 'content.create' | 'content.edit' | 'content.delete'
  | 'content.publish' | 'content.unpublish'
  | 'site.deploy'
  | 'users.manage' | 'roles.manage' | 'settings.manage' | 'theme.manage'

export type Role = 'owner' | 'publisher' | 'editor' | 'author' | 'viewer'

export interface Actor {
  id: string
  role: Role
}

/** Role → the set of actions it may perform. */
export type PermissionMatrix = Record<Role, ReadonlySet<Action>>

export interface Authz {
  can(actor: Actor, action: Action): boolean
}

import type { Action, Actor, Authz, PermissionMatrix } from './types'
export { DEFAULT_ROLES } from './default-roles'

/** Pure authorization: an actor's role → the matrix's allowed action set. */
export function createAuthz(matrix: PermissionMatrix): Authz {
  return {
    can(actor: Actor, action: Action): boolean {
      return matrix[actor.role]?.has(action) ?? false
    },
  }
}

import type { Action, PermissionMatrix } from './types'

const ALL: Action[] = [
  'content.create', 'content.edit', 'content.delete',
  'content.publish', 'content.unpublish',
  'site.deploy',
  'users.manage', 'roles.manage', 'settings.manage', 'theme.manage',
]

const EDITOR: Action[] = ['content.create', 'content.edit', 'content.delete', 'content.publish', 'content.unpublish']
const AUTHOR: Action[] = ['content.create', 'content.edit']

/** Default role → permissions. Admins can customize later (the matrix is data). */
export const DEFAULT_ROLES: PermissionMatrix = {
  owner: new Set(ALL),
  publisher: new Set<Action>(['site.deploy', ...EDITOR]),
  editor: new Set(EDITOR),
  author: new Set(AUTHOR),
  viewer: new Set<Action>(),
}

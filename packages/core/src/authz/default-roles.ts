import type { Action, PermissionMatrix } from './types'

// Building blocks, composed bottom-up so each role visibly extends the one below
// it (viewer ⊂ author ⊂ editor ⊂ maintainer ⊂ admin, with a couple of exceptions
// the matrix in epic #359 spells out). Coarse form only — ownership (#363) and
// rank-scoping (#364) are not modelled here.

/** Viewer — read-only across the surfaces a signed-in user can see. */
const VIEW: Action[] = ['content.view', 'taxonomy.view', 'media.view']

/** Author — creates and manages content + media (edit/delete coarse until #363),
 *  can create tags, but cannot publish, edit taxonomy, or delete media. */
const AUTHOR: Action[] = [
  ...VIEW,
  'content.create', 'content.edit', 'content.delete',
  'taxonomy.create',
  'media.upload', 'media.edit',
]

/** Editor — full content lifecycle across any author's work + full taxonomy +
 *  full media. No forms, site health, ops, or config. */
const EDITOR: Action[] = [
  ...VIEW,
  'content.create', 'content.edit', 'content.delete', 'content.publish', 'content.unpublish',
  'taxonomy.create', 'taxonomy.edit', 'taxonomy.delete',
  'media.upload', 'media.edit', 'media.delete',
]

/** Maintainer — runs the site day-to-day: everything Editor can do, plus forms,
 *  site health, deploy, theme, view settings, and manage below-rank users. NOT
 *  the four Admin-only levers (manage settings, delete users, roles editor, act
 *  on same-or-higher rank). */
const MAINTAINER: Action[] = [
  ...EDITOR,
  'forms.view', 'forms.manage',
  'sitehealth.view', 'site.deploy', 'theme.manage',
  'settings.view',
  'users.view', 'users.invite', 'users.setRole', 'users.disable',
]

/** Admin — full control. Maintainer + the four Admin-only levers. */
const ADMIN: Action[] = [
  ...MAINTAINER,
  'settings.manage',
  'users.delete',
  'roles.manage',
]

/** Default role → permissions (epic #359 approved table, 2026-07-04). This is the
 *  compile-time matrix; #360 makes it data-driven with this as the defaults. */
export const DEFAULT_ROLES: PermissionMatrix = {
  admin: new Set(ADMIN),
  maintainer: new Set(MAINTAINER),
  editor: new Set(EDITOR),
  author: new Set(AUTHOR),
  viewer: new Set(VIEW),
}

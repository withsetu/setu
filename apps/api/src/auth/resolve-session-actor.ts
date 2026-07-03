import type { Actor, Role } from '@setu/core'
import type { AuthInstance } from '@setu/auth'
import type { ResolveActor } from './resolve-actor'

const ROLES: readonly string[] = ['owner', 'publisher', 'editor', 'author', 'viewer']

export function resolveSessionActor(auth: AuthInstance): ResolveActor {
  return async (req) => {
    try {
      const session = await auth.api.getSession({ headers: req.headers })
      if (!session?.user || session.user.banned) return null
      const role = ROLES.includes(session.user.role) ? (session.user.role as Role) : 'viewer'
      return { id: session.user.id, role }
    } catch {
      return null // fail closed (#291)
    }
  }
}

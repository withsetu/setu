import type { Actor } from '@setu/core'

/** Resolve the acting user for a request, or null if unauthenticated.
 *  This is the seam real auth (JWT/session) slots into later — without
 *  touching any route. */
export type ResolveActor = (req: Request) => Actor | null | Promise<Actor | null>

/** Dev resolver — the single local owner the admin already assumes. */
export const resolveLocalOwner: ResolveActor = () => ({ id: 'local', role: 'owner' })

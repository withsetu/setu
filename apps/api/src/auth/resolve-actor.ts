import type { Actor, GitAuthor } from '@setu/core'

/** The resolved actor; `gitAuthor` (when the resolver knows the user's identity) is
 *  stamped server-side onto git commits — the client-supplied author is never trusted
 *  (#382). Absent (e.g. `resolveLocalOwner`) → the commit routes fall back to the
 *  request body's author. */
export type ResolvedActor = Actor & { gitAuthor?: GitAuthor }

/** Resolve the acting user for a request, or null if unauthenticated.
 *  This is the seam real auth (JWT/session) slots into later — without
 *  touching any route. */
export type ResolveActor = (
  req: Request
) => ResolvedActor | null | Promise<ResolvedActor | null>

/** Dev resolver — the single local admin the admin UI already assumes. No `gitAuthor`: the
 *  local dev/no-session path keeps trusting the request body's author (unchanged). */
export const resolveLocalOwner: ResolveActor = () => ({
  id: 'local',
  role: 'admin'
})

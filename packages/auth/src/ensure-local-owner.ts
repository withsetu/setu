import type { AuthInstance } from './index'

export interface LocalOwnerIdentity {
  email: string
  name: string
}

/** First-run bootstrap for the local topology (#248 Task 7): idempotently ensures a single
 *  owner-role user exists, identified by `identity.email` (resolved by the caller — server.ts —
 *  from `git config user.email`/`user.name`, falling back to owner@localhost/Owner when git
 *  config is unavailable).
 *
 *  Uses `auth.$context` — Better Auth's own awaitable internal context object (the same one every
 *  endpoint receives as `ctx.context`; returned directly on the `auth` instance as a public
 *  property, see node_modules/better-auth/dist/auth/base.mjs's `createBetterAuth`) — to reach
 *  `internalAdapter.createUser` / `internalAdapter.findUserByEmail` directly, rather than going
 *  through `auth.api.createUser` (the admin plugin's HTTP endpoint). Two reasons:
 *
 *   1. Typing: `createAuth` (./index.ts) builds its plugin list as `BetterAuthPlugin[]`, which
 *      erases each plugin's specific endpoint types — so `auth.api` here only carries the base
 *      (non-plugin) surface and doesn't expose `createUser` at all (verified: `tsc` reports only
 *      `ok` on the inferred `api` type). `$context.internalAdapter` is properly typed
 *      (`@better-auth/core`'s `InternalAdapter.createUser<T>`) and isn't affected by that gap —
 *      the same gap Task 4 sidestepped for `localToken`'s endpoint by calling `auth.handler` with
 *      a raw Request instead of `auth.api.localExchange`.
 *   2. Directness: `internalAdapter.createUser` IS the exact primitive the admin plugin's
 *      `createUser` route itself calls (node_modules/better-auth/dist/plugins/admin/routes.mjs:
 *      `ctx.context.internalAdapter.createUser({ ...userData, email, name, role })`, and — only
 *      `if (ctx.body.password)` — a separate `internalAdapter.linkAccount({ providerId:
 *      'credential', ... })` call). Calling `internalAdapter.createUser` with no follow-up
 *      `linkAccount` call reproduces that same "no password given" path precisely: no credential
 *      account row is created, so there is nothing to sign in with — this is the documented
 *      passwordless-user shape (see `createUserBodySchema`'s description of the optional
 *      `password` field: "If not provided, the user will be created without a credential account
 *      (useful for magic link or social login only users)"), not a hand-rolled bypass of it.
 *
 *  Idempotency: `findUserByEmail` first — the admin plugin's own `/admin/get-user` endpoint
 *  requires an authenticated admin session (`use: [adminMiddleware]`), which doesn't exist yet
 *  during first-run bootstrap (nobody is signed in) — `$context` is the sanctioned way to query
 *  before any session exists, not a bypass of anything `createUser` itself guards (the admin
 *  route performs this identical lookup internally before deciding to insert vs. reject as a
 *  duplicate). If a user with this email already exists, its id is returned unchanged (no new
 *  row, no role/name overwrite) — safe to call on every local boot. */
export async function ensureLocalOwner(auth: AuthInstance, identity: LocalOwnerIdentity): Promise<string> {
  const context = await auth.$context
  const existing = await context.internalAdapter.findUserByEmail(identity.email)
  if (existing) return existing.user.id

  const user = await context.internalAdapter.createUser({
    email: identity.email,
    name: identity.name,
    emailVerified: false,
    role: 'admin',
  })
  return user.id
}

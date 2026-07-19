import { APIError } from '@better-auth/core/error'
import type { GenericEndpointContext } from '@better-auth/core'

/** #645 — "Setu never creates a user through a sign-in route", enforced at the creation chokepoint.
 *
 *  ## The residual this closes
 *
 *  #624 locked social sign-up by setting BOTH `disableSignUp: true` and `disableImplicitSignUp:
 *  true` on every provider config, and asserted exactly that in its test — the flags are present
 *  on the config object. Configuration shape, not behaviour. It missed that the two better-auth
 *  routes which consume those flags read DIFFERENT PROPERTIES, and only one of them ever sees
 *  `disableSignUp`.
 *
 *  Verified in the INSTALLED better-auth 1.6.23 (read, not assumed):
 *   - `dist/context/create-context.mjs:102-103` builds each provider as
 *     `socialProviders[key](config)` and then hoists exactly ONE field:
 *     `provider.disableImplicitSignUp = config.disableImplicitSignUp`. `disableSignUp` is never
 *     hoisted, and no provider factory sets it — `@better-auth/core/dist/social-providers/
 *     google.mjs` returns `{ id, name, …, options }` with no spread of `options`, so the
 *     configured value survives only under `provider.options`.
 *   - `dist/api/routes/callback.mjs:150` reads `provider.options?.disableSignUp` → `true`. Closed.
 *   - `dist/api/routes/sign-in.mjs:115` reads `provider.disableSignUp` — TOP LEVEL, `undefined`:
 *       `provider.disableImplicitSignUp && !c.body.requestSignUp || provider.disableSignUp`
 *     `requestSignUp` is a caller-supplied field of the `/sign-in/social` body schema
 *     (`sign-in.mjs:35`), so an attacker sending `requestSignUp: true` reduces this to
 *     `true && false || undefined` → falsy → **sign-up permitted**, creating a user at the schema
 *     default role `author` (`packages/db-sqlite/src/schema.ts`). Reachable whenever Google is
 *     configured (`sign-in.mjs:76-79` requires `verifyIdToken`, which only Google supplies), with
 *     a Google ID token whose `aud` is the deployment's PUBLIC client id.
 *
 *  ## Why the fix is not "also set the flag at the provider top level"
 *
 *  Because the `socialProviders` config surface cannot reach that property. better-auth constructs
 *  the provider object itself and copies across exactly one field (above), so no key we can put in
 *  `authSocialProvidersFromEnv`'s output lands on `provider.disableSignUp`. Setting it in the
 *  config is already done and already closes the callback route; there is no configuration-only
 *  fix for the sign-in route in 1.6.23.
 *
 *  ## What this guard does instead — an ALLOWLIST at the chokepoint, not a patch on the bypass
 *
 *  Neutralizing `requestSignUp` would close this exact bypass and leave the shape of the bug
 *  intact: our protection would still be a dependency's internal boolean expression, re-derived
 *  from two flags whose plumbing we do not control and which already drifted apart once.
 *
 *  So the guard sits where every account actually comes into existence — `internalAdapter.
 *  createUser` → the `user.create.before` databaseHook — and ALLOWLISTS the request paths Setu
 *  legitimately creates users from. Anything else fails closed, whatever better-auth's flags say.
 *  That is the #623 lesson applied here: reject the class, don't enumerate the spellings.
 *
 *  The complete set of legitimate creators (grepped, not assumed — `internalAdapter.createUser` /
 *  `auth.api.createUser` have no other call sites in this repo):
 *   - `/setup` — first-run owner, `server-setup-plugin.ts:86`.
 *   - `/admin/create-user` — the admin plugin's invite route, already gated by better-auth's own
 *     `hasPermission` plus `rank-guard.ts` and `single-role-guard.ts`.
 *   - `/local/exchange` — the local-topology handshake (`local-token-plugin.ts:88`). Its handler
 *     calls `opts.localUserId()`, which is wired to `ensureLocalOwner` (`apps/api/src/local-
 *     token.ts:86`) → `internalAdapter.createUser` (`ensure-local-owner.ts:52`), so this path DOES
 *     run with a request context and is a genuine creator. The route is already gated on a
 *     single-use filesystem handshake token plus a loopback Host check — the desktop app proving
 *     it is the local user. This entry was missing from the first draft of the allowlist and
 *     `local-token-exchange.test.ts` failed loudly (403 where 200 was expected), which is the
 *     allowlist behaving exactly as intended: fail closed, and make the omission impossible to
 *     miss.
 *   - NO request context at all — `e2e/lib/seed-users.ts:48` calls `internalAdapter.createUser`
 *     directly, host-side, with no endpoint in scope. `single-role-guard.ts` and `rank-guard.ts`
 *     already treat a null context as a bootstrap/internal call for the same reason.
 *
 *  `/sign-up/email` is absent from the list deliberately: `createAuth` sets `disableSignUp: true`
 *  on `emailAndPassword`, so it has no legitimate caller either, and this guard is now a second
 *  wall behind that flag rather than a restatement of it. */

/** Request paths permitted to create a user. Everything else — every OAuth route, every future
 *  sign-in route a better-auth upgrade adds — fails closed. */
const USER_CREATING_PATHS: ReadonlySet<string> = new Set([
  '/setup',
  '/admin/create-user',
  '/local/exchange'
])

/** `user.create.before` — refuses account creation from any route that is not an invite path. */
export function signupOriginGuardCreateHook() {
  return async (
    _user: Record<string, unknown>,
    context: GenericEndpointContext | null
  ): Promise<void> => {
    // Bootstrap/internal call (ensureLocalOwner, e2e seeding, maintenance scripts): no endpoint is
    // in scope, so there is no untrusted request to gate. Mirrors single-role-guard.ts.
    if (!context) return
    if (USER_CREATING_PATHS.has(context.path)) return
    throw new APIError('FORBIDDEN', {
      message:
        'this Setu instance is invite-only — accounts are created by an administrator, not by signing in',
      code: 'SIGNUP_DISABLED'
    })
  }
}

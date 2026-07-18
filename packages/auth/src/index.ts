import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, captcha } from 'better-auth/plugins'
import { defaultAc } from 'better-auth/plugins/admin/access'
import * as schema from '@setu/db-sqlite/schema'
import { SETU_ROLES, type CreateAuthOptions } from './options'
import { localToken } from './local-token-plugin'
import { serverSetup } from './server-setup-plugin'
import {
  lastAdminGuardHook,
  lastAdminDeleteGuardHook
} from './last-owner-guard'
import { rankGuardCreateHook, rankGuardUpdateHook } from './rank-guard'
import {
  userCreateAfterHook,
  sessionCreateAfterHook,
  sessionDeleteAfterHook,
  userUpdateAfterHook,
  userDeleteAfterHook,
  adminSetPasswordHook
} from './audit-hooks'
import {
  resetPasswordEmailContent,
  withDefaultResetCallback
} from './reset-password-email'
export { SETU_ROLES, type CreateAuthOptions } from './options'
export {
  localToken,
  isLoopbackHost,
  constantTimeTokenEquals,
  type LocalTokenOptions
} from './local-token-plugin'
export { serverSetup, type ServerSetupOptions } from './server-setup-plugin'
export { ensureLocalOwner, type LocalOwnerIdentity } from './ensure-local-owner'
export type { AuthEvent, AuthEventType } from './events'

// better-auth's admin plugin validates `adminRoles` against the keys of a
// `roles` access-control map (defaulting to its own `{ admin, user }` map). We
// supply an explicit `roles` map naming all four Setu roles (admin|maintainer|
// editor|author), which REPLACES that default entirely — so even though
// Setu's top role is now also literally `admin`, it's our `admin` definition
// below (not better-auth's built-in one) that governs the admin plugin's
// user/session statements.
//
// #364: `maintainer` is now widened beyond an empty placeholder. Verified against installed
// better-auth 1.6.23 source (`dist/plugins/admin/has-permission.mjs` + `dist/plugins/admin/
// routes.mjs`, see rank-guard.ts's file doc for the full citation): a role's `roles` statements —
// NOT the `adminRoles` list — are what better-auth's own `hasPermission` checks to authorize
// `/admin/create-user`, `/admin/set-role`, `/admin/ban-user`, and `/admin/unban-user`. Granting
// `user: ['create', 'set-role', 'ban']` is exactly enough for a maintainer to create/promote/demote/
// ban/unban users at all (ban-user and unban-user share the single `ban` statement); it does NOT by
// itself scope WHO a maintainer may target or WHAT role they may hand out — that per-call, per-
// target rank check (maintainer may only manage/assign strictly below their own rank) is enforced
// separately by `rank-guard.ts`'s databaseHooks, composed below. `delete`, `set-password`,
// `impersonate`, `set-email`, `get`, and `list` are deliberately withheld from maintainer:
//  - `delete`/`set-password`: no rank-aware databaseHook can gate these (set-user-password never
//    touches the `user` table at all — see rank-guard.ts) or is designed to (remove-user should
//    stay admin-only per the task brief), so they must stay off the statement entirely — better-
//    auth's own `hasPermission` 403s a maintainer before any hook runs.
//  - `impersonate`/`set-email`/`get`/`list`: out of scope for #364 (rank-scoped user MANAGEMENT),
//    left for a future increment if the product ever needs maintainer-level impersonation or a
//    maintainer-scoped user directory.
// `editor`/`author` remain empty placeholders — Setu's own authorization (outside better-auth)
// governs what they can do, and neither ever reaches an admin-plugin route.
const setuAdminRoles = {
  admin: defaultAc.newRole({
    user: [
      'create',
      'list',
      'set-role',
      'ban',
      'impersonate',
      'delete',
      'set-password',
      'set-email',
      'get',
      'update'
    ],
    session: ['list', 'revoke', 'delete']
  }),
  maintainer: defaultAc.newRole({
    user: ['create', 'set-role', 'ban']
  }),
  editor: defaultAc.newRole({ user: [], session: [] }),
  author: defaultAc.newRole({ user: [], session: [] })
} satisfies Record<
  (typeof SETU_ROLES)[number],
  ReturnType<typeof defaultAc.newRole>
>

export function createAuth(opts: CreateAuthOptions) {
  // Structured audit-event seam (#248 Task 9). Defaults to a no-op so every existing caller of
  // createAuth (tests, and any future consumer that doesn't opt in) keeps total silence — server.ts
  // is the one place that supplies the real default (a console.info line). Threaded into the two
  // plugins below (their own direct emission points — local.exchange / setup.completed) as well as
  // the databaseHooks wired further down.
  const emit = opts.onAuthEvent ?? (() => {})

  const plugins: BetterAuthPlugin[] = [
    admin({
      adminRoles: ['admin'],
      defaultRole: 'author',
      roles: setuAdminRoles
    })
  ]
  if (opts.captcha) {
    plugins.push(
      captcha({
        provider: opts.captcha.provider,
        secretKey: opts.captcha.secretKey
      })
    )
  }
  if (opts.localToken) {
    plugins.push(localToken({ ...opts.localToken, onAuthEvent: emit }))
  }
  if (opts.serverSetup) {
    plugins.push(serverSetup({ ...opts.serverSetup, onAuthEvent: emit }))
  }

  // #364: `sendResetPassword` is added ONLY when the caller supplied an `email` option — omitting
  // it entirely (rather than passing e.g. a no-op) is what makes better-auth's own
  // `request-password-reset` route throw `RESET_PASSWORD_DISABLED`, preserving today's "reset
  // disabled" behavior byte-for-byte whenever the option is absent (tests, and any topology
  // without a real email transport wired up).
  //
  // Verified against the installed better-auth 1.6.23 source
  // (node_modules/better-auth/dist/api/routes/password.mjs):
  //  - line 42: `if (!ctx.context.options.emailAndPassword?.sendResetPassword) { ... throw
  //    APIError.from('BAD_REQUEST', { ..., code: 'RESET_PASSWORD_DISABLED' }) }` — confirms the
  //    callback's mere presence/absence is the entire gate, exactly as relied on here.
  //  - lines 73-77: the callback is invoked as
  //    `sendResetPassword({ user: user.user, url, token: verificationToken }, ctx.request)` —
  //    the `{ user, url, token }` signature this file destructures below.
  //  - line 72: `url` is built as `` `${ctx.context.baseURL}/reset-password/${token}?callbackURL=${callbackURL}` ``
  //    where `ctx.context.baseURL` is `opts.baseURL` + this file's own `basePath` ('/api/auth')
  //    and `callbackURL` is the caller-supplied `redirectTo` from the request body — EMPTY when
  //    the requester omitted it, which the `/reset-password/:token` callback route then rejects
  //    as INVALID_TOKEN (line 115: `if (!token || !callbackURL) throw ctx.redirect(...)`) — a
  //    guaranteed dead link. withDefaultResetCallback below closes that hole: it fills in
  //    `opts.email.resetRedirectTo` (the admin origin's /reset-password route, supplied by
  //    server.ts) whenever the built link's callbackURL is empty/absent, and preserves better-
  //    auth's URL untouched (token path segment + encoded callbackURL) whenever the requester DID
  //    pass an explicit redirectTo.
  const emailOpt = opts.email
  const emailAndPassword: Parameters<typeof betterAuth>[0]['emailAndPassword'] =
    {
      enabled: true,
      disableSignUp: true,
      ...(emailOpt
        ? {
            sendResetPassword: async ({ user, url }) => {
              const content = resetPasswordEmailContent(
                withDefaultResetCallback(url, emailOpt.resetRedirectTo)
              )
              await emailOpt.send({
                to: user.email,
                from: emailOpt.from,
                ...content
              })
            }
          }
        : {})
    }

  return betterAuth({
    database: drizzleAdapter(opts.db, { provider: 'sqlite', schema }),
    secret: opts.secret,
    baseURL: opts.baseURL,
    basePath: '/api/auth',
    trustedOrigins: opts.trustedOrigins,
    // Setu is invite-only: the owner is created via first-run setup (server-setup-plugin) or
    // ensureLocalOwner, and every other user is created by an owner/admin through the admin
    // plugin's createUser — all three go through internalAdapter.createUser directly, never this
    // route. Public sign-up (`POST /api/auth/sign-up/email`) has no legitimate caller, and leaving
    // it open lets an anonymous visitor sign up first and permanently pre-empt first-run owner
    // setup (needsSetup flips to false the moment ANY user row exists, not just the owner's).
    emailAndPassword,
    socialProviders: opts.socialProviders,
    // Server-side last-admin enforcement (#248 Task 8 review, Finding 1) + #364 rank enforcement:
    // every consumer of this `auth` instance — our own routes, a future public API, or a raw HTTP
    // call by any admin/maintainer session — is covered, not just the admin UI's client-side guard
    // (see UsersSettings.tsx's roleChangeGuard/disableGuard, which remain as a first line of UX
    // feedback but are no longer the ONLY protection). See last-owner-guard.ts and rank-guard.ts for
    // the full derivation of why these hooks can see the target user id and the acting session
    // despite neither being an explicit hook argument.
    //
    // `update.before` composes TWO independent guards (better-auth's databaseHooks type only
    // accepts a single `before` function per model/event, so they're composed explicitly here,
    // not registered as a list): rankGuardUpdateHook MUST run first — it's the one that stops a
    // maintainer from touching a peer/admin target or self-escalating a role at all — before
    // lastAdminGuardHook, which only ever cares about admin targets and would be a no-op for the
    // maintainer-vs-maintainer/editor cases rank-guard exists to catch. Both throw (rather than
    // returning `false`) on violation, so composing them as a plain sequential `await` is sufficient
    // — the first to throw aborts the update before the second (or the DB write) ever runs.
    //
    // The five `after` hooks are #248 Task 9's audit-event emission points — see audit-hooks.ts
    // for the full per-event-type mechanism derivation (user.created / login.success / logout /
    // role.changed / user.banned / user.unbanned / user.deleted, the last three also covering
    // /admin/update-user and /admin/remove-user respectively). They run strictly after the
    // `before` guards above (which may themselves abort the create/update/delete), so an event
    // only ever fires for a change that actually committed.
    databaseHooks: {
      user: {
        create: {
          before: rankGuardCreateHook(),
          after: userCreateAfterHook(emit)
        },
        update: {
          before: async (data, context) => {
            await rankGuardUpdateHook()(data, context)
            await lastAdminGuardHook()(data, context)
          },
          after: userUpdateAfterHook(emit)
        },
        // Deletion is a SEPARATE chokepoint from update (deleteWithHooks, not updateWithHooks) —
        // `/admin/remove-user` on the last active admin would otherwise bypass the guard above
        // entirely. See last-owner-guard.ts's lastAdminDeleteGuardHook doc for the full mechanism.
        // No rank-guard delete hook is needed: maintainer's statements withhold `delete` entirely
        // (see setuAdminRoles above), so only `admin` ever reaches this route — rank-guard.ts's
        // file doc covers why.
        delete: {
          before: lastAdminDeleteGuardHook(),
          after: userDeleteAfterHook(emit)
        }
      },
      session: {
        create: { after: sessionCreateAfterHook(emit) },
        delete: { after: sessionDeleteAfterHook(emit) }
      },
      // #632: the ONLY reason an `account` hook exists here. `/admin/set-user-password` writes the
      // `account` table and nothing else, so it is invisible to every `user`-model hook above.
      // Both branches of that route are covered by the one path-gated emitter — see
      // adminSetPasswordHook's doc for which branch reaches which hook, and why.
      account: {
        create: { after: adminSetPasswordHook(emit) },
        update: { after: adminSetPasswordHook(emit) }
      }
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' }
    },
    rateLimit: {
      enabled: opts.rateLimit?.enabled ?? true,
      storage: 'database',
      window: opts.rateLimit?.window ?? 60,
      max: opts.rateLimit?.max ?? 100,
      customRules: { '/sign-in/email': { window: 10, max: 3 } }
    },
    plugins
  })
}

export type AuthInstance = ReturnType<typeof createAuth>

/** Better-auth's internal context over an existing drizzle handle, for HOST-SIDE maintenance
 *  tools that run with no server and no session — apps/api's `auth:reset-password` script and
 *  e2e/lib/seed-users.ts. Both need exactly `$context`'s `internalAdapter` (user/account rows)
 *  and `ctx.password.hash` (scrypt), so this helper owns the throwaway instance both used to
 *  duplicate inline (#386 review).
 *
 *  secret/baseURL/trustedOrigins are required by createAuth but irrelevant here: nothing this
 *  context is used for signs a session — scrypt hashing is secret-independent, so passwords
 *  written through it verify unchanged under the REAL server's secret at `/sign-in/email`.
 *  That's the whole trick: callers reuse the exact seeding path the server's own admin-invite
 *  and `ensureLocalOwner` use (internalAdapter.createUser/linkAccount/updatePassword), never a
 *  parallel auth system or hand-forged rows. */
export function openInternalAuthContext(
  db: CreateAuthOptions['db']
): AuthInstance['$context'] {
  return createAuth({
    db,
    secret: 'internal-auth-context-never-signs-a-session',
    baseURL: 'http://localhost:4444',
    trustedOrigins: []
  }).$context
}

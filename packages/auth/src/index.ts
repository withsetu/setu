import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, captcha } from 'better-auth/plugins'
import { defaultAc } from 'better-auth/plugins/admin/access'
import * as schema from '@setu/db-sqlite/schema'
import { SETU_ROLES, type CreateAuthOptions } from './options'
import { localToken } from './local-token-plugin'
import { serverSetup } from './server-setup-plugin'
import { lastOwnerGuardHook, lastOwnerDeleteGuardHook } from './last-owner-guard'
import {
  userCreateAfterHook,
  sessionCreateAfterHook,
  sessionDeleteAfterHook,
  userUpdateAfterHook,
  userDeleteAfterHook,
} from './audit-hooks'
import type { AuthEvent } from './events'

export { SETU_ROLES, type CreateAuthOptions } from './options'
export { localToken, isLoopbackHost, constantTimeTokenEquals, type LocalTokenOptions } from './local-token-plugin'
export { serverSetup, type ServerSetupOptions } from './server-setup-plugin'
export { ensureLocalOwner, type LocalOwnerIdentity } from './ensure-local-owner'
export type { AuthEvent, AuthEventType } from './events'

// better-auth's admin plugin validates `adminRoles` against the keys of a
// `roles` access-control map (defaulting to its own `{ admin, user }` map). We
// supply an explicit `roles` map naming all four Setu roles (admin|maintainer|
// editor|author), which REPLACES that default entirely — so even though
// Setu's top role is now also literally `admin`, it's our `admin` definition
// below (not better-auth's built-in one) that governs the admin plugin's
// user/session statements. Only 'admin' is granted admin-plugin permissions
// (user/session management); the rest are placeholders with no admin-plugin
// statements — Setu's own authorization (outside better-auth) governs what
// maintainer/editor/author can do.
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
      'update',
    ],
    session: ['list', 'revoke', 'delete'],
  }),
  maintainer: defaultAc.newRole({ user: [], session: [] }),
  editor: defaultAc.newRole({ user: [], session: [] }),
  author: defaultAc.newRole({ user: [], session: [] }),
} satisfies Record<(typeof SETU_ROLES)[number], ReturnType<typeof defaultAc.newRole>>

export function createAuth(opts: CreateAuthOptions) {
  // Structured audit-event seam (#248 Task 9). Defaults to a no-op so every existing caller of
  // createAuth (tests, and any future consumer that doesn't opt in) keeps total silence — server.ts
  // is the one place that supplies the real default (a console.info line). Threaded into the two
  // plugins below (their own direct emission points — local.exchange / setup.completed) as well as
  // the databaseHooks wired further down.
  const emit = opts.onAuthEvent ?? (() => {})

  const plugins: BetterAuthPlugin[] = [
    admin({ adminRoles: ['admin'], defaultRole: 'author', roles: setuAdminRoles }),
  ]
  if (opts.captcha) {
    plugins.push(captcha({ provider: opts.captcha.provider, secretKey: opts.captcha.secretKey }))
  }
  if (opts.localToken) {
    plugins.push(localToken({ ...opts.localToken, onAuthEvent: emit }))
  }
  if (opts.serverSetup) {
    plugins.push(serverSetup({ ...opts.serverSetup, onAuthEvent: emit }))
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
    emailAndPassword: { enabled: true, disableSignUp: true },
    socialProviders: opts.socialProviders,
    // Server-side last-owner enforcement (#248 Task 8 review, Finding 1): every consumer of this
    // `auth` instance — our own routes, a future public API, or a raw HTTP call by any owner
    // session — is covered, not just the admin UI's client-side guard (see UsersSettings.tsx's
    // roleChangeGuard/disableGuard, which remain as a first line of UX feedback but are no longer
    // the ONLY protection). See last-owner-guard.ts for the full derivation of why this mechanism
    // (databaseHooks.user.update.before) can see the target user id despite not receiving it as an
    // explicit hook argument.
    //
    // The five `after` hooks are #248 Task 9's audit-event emission points — see audit-hooks.ts
    // for the full per-event-type mechanism derivation (user.created / login.success / logout /
    // role.changed / user.banned / user.unbanned / user.deleted, the last three also covering
    // /admin/update-user and /admin/remove-user respectively). They run strictly after the
    // last-owner guard's `before` hooks (which may themselves abort the update/delete), so an
    // event only ever fires for a change that actually committed.
    databaseHooks: {
      user: {
        create: { after: userCreateAfterHook(emit) },
        update: {
          before: lastOwnerGuardHook(),
          after: userUpdateAfterHook(emit),
        },
        // Deletion is a SEPARATE chokepoint from update (deleteWithHooks, not updateWithHooks) —
        // `/admin/remove-user` on the last active owner would otherwise bypass the guard above
        // entirely. See last-owner-guard.ts's lastOwnerDeleteGuardHook doc for the full mechanism.
        delete: {
          before: lastOwnerDeleteGuardHook(),
          after: userDeleteAfterHook(emit),
        },
      },
      session: {
        create: { after: sessionCreateAfterHook(emit) },
        delete: { after: sessionDeleteAfterHook(emit) },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    rateLimit: {
      enabled: opts.rateLimit?.enabled ?? true,
      storage: 'database',
      window: opts.rateLimit?.window ?? 60,
      max: opts.rateLimit?.max ?? 100,
      customRules: { '/sign-in/email': { window: 10, max: 3 } },
    },
    plugins,
  })
}

export type AuthInstance = ReturnType<typeof createAuth>

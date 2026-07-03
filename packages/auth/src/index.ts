import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, captcha } from 'better-auth/plugins'
import { defaultAc } from 'better-auth/plugins/admin/access'
import * as schema from '@setu/db-sqlite/schema'
import { SETU_ROLES, type CreateAuthOptions } from './options'
import { localToken } from './local-token-plugin'
import { serverSetup } from './server-setup-plugin'
import { lastOwnerGuardHook, lastOwnerDeleteGuardHook } from './last-owner-guard'
import { userCreateAfterHook, sessionCreateAfterHook, sessionDeleteAfterHook, userUpdateAfterHook } from './audit-hooks'
import type { AuthEvent } from './events'

export { SETU_ROLES, type CreateAuthOptions } from './options'
export { localToken, isLoopbackHost, constantTimeTokenEquals, type LocalTokenOptions } from './local-token-plugin'
export { serverSetup, type ServerSetupOptions } from './server-setup-plugin'
export { ensureLocalOwner, type LocalOwnerIdentity } from './ensure-local-owner'
export type { AuthEvent, AuthEventType } from './events'

// better-auth's admin plugin validates `adminRoles` against the keys of a
// `roles` access-control map (defaulting to its own `{ admin, user }` map).
// Setu's role set (owner|publisher|editor|author|viewer) doesn't overlap with
// that default, so `adminRoles: ['owner']` throws unless we supply an
// explicit `roles` map naming all five Setu roles. Only 'owner' is granted
// admin-plugin permissions (user/session management); the rest are
// placeholders with no admin-plugin statements — Setu's own authorization
// (outside better-auth) governs what publisher/editor/author/viewer can do.
const setuAdminRoles = {
  owner: defaultAc.newRole({
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
  publisher: defaultAc.newRole({ user: [], session: [] }),
  editor: defaultAc.newRole({ user: [], session: [] }),
  author: defaultAc.newRole({ user: [], session: [] }),
  viewer: defaultAc.newRole({ user: [], session: [] }),
} satisfies Record<(typeof SETU_ROLES)[number], ReturnType<typeof defaultAc.newRole>>

export function createAuth(opts: CreateAuthOptions) {
  // Structured audit-event seam (#248 Task 9). Defaults to a no-op so every existing caller of
  // createAuth (tests, and any future consumer that doesn't opt in) keeps total silence — server.ts
  // is the one place that supplies the real default (a console.info line). Threaded into the two
  // plugins below (their own direct emission points — local.exchange / setup.completed) as well as
  // the databaseHooks wired further down.
  const emit = opts.onAuthEvent ?? (() => {})

  const plugins: BetterAuthPlugin[] = [
    admin({ adminRoles: ['owner'], defaultRole: 'viewer', roles: setuAdminRoles }),
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
    emailAndPassword: { enabled: true },
    socialProviders: opts.socialProviders,
    // Server-side last-owner enforcement (#248 Task 8 review, Finding 1): every consumer of this
    // `auth` instance — our own routes, a future public API, or a raw HTTP call by any owner
    // session — is covered, not just the admin UI's client-side guard (see UsersSettings.tsx's
    // roleChangeGuard/disableGuard, which remain as a first line of UX feedback but are no longer
    // the ONLY protection). See last-owner-guard.ts for the full derivation of why this mechanism
    // (databaseHooks.user.update.before) can see the target user id despite not receiving it as an
    // explicit hook argument.
    //
    // The four `after` hooks are #248 Task 9's audit-event emission points — see audit-hooks.ts
    // for the full per-event-type mechanism derivation (user.created / login.success / logout /
    // role.changed / user.banned / user.unbanned). They run strictly after the last-owner guard's
    // `before` hook (which may itself abort the update), so an event only ever fires for a change
    // that actually committed.
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
      enabled: true,
      storage: 'database',
      window: opts.rateLimit?.window ?? 60,
      max: opts.rateLimit?.max ?? 100,
      customRules: { '/sign-in/email': { window: 10, max: 3 } },
    },
    plugins,
  })
}

export type AuthInstance = ReturnType<typeof createAuth>

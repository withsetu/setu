import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, captcha } from 'better-auth/plugins'
import { defaultAc } from 'better-auth/plugins/admin/access'
import * as schema from '@setu/db-sqlite/schema'
import { SETU_ROLES, type CreateAuthOptions } from './options'
import { localToken } from './local-token-plugin'

export { SETU_ROLES, type CreateAuthOptions } from './options'
export { localToken, isLoopbackHost, constantTimeTokenEquals, type LocalTokenOptions } from './local-token-plugin'

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
  const plugins: BetterAuthPlugin[] = [
    admin({ adminRoles: ['owner'], defaultRole: 'viewer', roles: setuAdminRoles }),
  ]
  if (opts.captcha) {
    plugins.push(captcha({ provider: opts.captcha.provider, secretKey: opts.captcha.secretKey }))
  }
  if (opts.localToken) {
    plugins.push(localToken(opts.localToken))
  }

  return betterAuth({
    database: drizzleAdapter(opts.db, { provider: 'sqlite', schema }),
    secret: opts.secret,
    baseURL: opts.baseURL,
    basePath: '/api/auth',
    trustedOrigins: opts.trustedOrigins,
    emailAndPassword: { enabled: true },
    socialProviders: opts.socialProviders,
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

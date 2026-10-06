import { describe, it, expect } from 'vitest'
import {
  authSocialProvidersFromEnv,
  socialProvidersEnabled
} from '../src/auth/env'

// #624 — Setu is invite-only: `createAuth` sets `disableSignUp: true` on emailAndPassword
// (packages/auth/src/index.ts) precisely so `POST /api/auth/sign-up/email` cannot create an
// account. But `authSocialProvidersFromEnv` emitted GitHub/Google provider objects with NO
// sign-up restriction at all, so simply setting SETU_GITHUB_CLIENT_ID/SECRET reopened open
// self-registration through the OAuth door: any stranger could OAuth in and be created with the
// schema default role `author` (packages/db-sqlite/src/schema.ts), and could also permanently
// pre-empt first-run owner setup.
//
// Verified against the INSTALLED better-auth 1.7.7 (not from memory):
//   - @better-auth/core/dist/oauth2/oauth-provider.d.mts declares BOTH `disableImplicitSignUp`
//     and `disableSignUp` on the social-provider config.
//   - `disableImplicitSignUp` is defeated by a caller-supplied `requestSignUp: true` (a field of
//     the /sign-in/social body schema, sign-in.mjs:102), so `disableSignUp` is the flag that
//     matters. Both of the routes that decide sign-up — callback.mjs:181 and, since 1.7.7,
//     sign-in.mjs:197 — read it from `provider.options`. Before 1.7.7 the sign-in route did
//     NOT (#645), which is why the actual wall is packages/auth/src/signup-origin-guard.ts and
//     these flags are defence in depth. This file pins only that the env builder sets them;
//     packages/auth/test/oauth-signup-guard.test.ts is where the behaviour is tested.
const githubEnv = {
  SETU_GITHUB_CLIENT_ID: 'gh-id',
  SETU_GITHUB_CLIENT_SECRET: 'gh-secret'
} as unknown as NodeJS.ProcessEnv
const bothEnv = {
  ...githubEnv,
  SETU_GOOGLE_CLIENT_ID: 'g-id',
  SETU_GOOGLE_CLIENT_SECRET: 'g-secret'
} as unknown as NodeJS.ProcessEnv

describe('authSocialProvidersFromEnv — OAuth cannot self-register (#624)', () => {
  it('marks EVERY returned provider as sign-up-disabled', () => {
    const providers = authSocialProvidersFromEnv(bothEnv)
    expect(providers).toBeDefined()
    const entries = Object.entries(providers!)
    expect(entries.map(([name]) => name).sort()).toEqual(['github', 'google'])
    for (const [name, provider] of entries) {
      expect(provider.disableSignUp, `${name}.disableSignUp`).toBe(true)
      expect(
        provider.disableImplicitSignUp,
        `${name}.disableImplicitSignUp`
      ).toBe(true)
    }
  })

  it('still carries the credentials through unchanged', () => {
    const providers = authSocialProvidersFromEnv(githubEnv)
    expect(providers?.github).toMatchObject({
      clientId: 'gh-id',
      clientSecret: 'gh-secret'
    })
    expect(providers?.google).toBeUndefined()
  })

  it('still omits providers entirely when unconfigured or half-configured', () => {
    expect(authSocialProvidersFromEnv({})).toBeUndefined()
    expect(
      authSocialProvidersFromEnv({ SETU_GITHUB_CLIENT_ID: 'only-id' })
    ).toBeUndefined()
  })

  it('leaves socialProvidersEnabled reporting the same provider names', () => {
    expect(socialProvidersEnabled(bothEnv)).toEqual(['github', 'google'])
    expect(socialProvidersEnabled(githubEnv)).toEqual(['github'])
    expect(socialProvidersEnabled({})).toEqual([])
  })
})

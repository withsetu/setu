import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { countUsers } from '@setu/db-sqlite'
import type { GoogleProfile } from '@better-auth/core/social-providers'
import { createAuth } from '../src'

// #645 — residual of #624. `authSocialProvidersFromEnv` sets BOTH `disableSignUp: true` and
// `disableImplicitSignUp: true` on every provider, and #624's test asserted exactly that: the
// flags are present on the config object. That assertion is about CONFIGURATION SHAPE, which is
// why this stayed open for a year — the flags were set, and one of the two routes that reads them
// never saw `disableSignUp` at all.
//
// What the INSTALLED better-auth did, file:line, read — not assumed. In 1.6.23 through 1.7.6:
//   - dist/context/create-context.mjs (1.7.7: lines 103-104)
//         const provider = socialProviders[key](config);
//         provider.disableImplicitSignUp = config.disableImplicitSignUp;
//     ONLY `disableImplicitSignUp` is hoisted to the provider's top level. `disableSignUp` is
//     never hoisted, and no provider factory sets it — @better-auth/core/dist/social-providers/
//     google.mjs returns `{ id, name, ..., options }` with NO spread of `options`, so the config
//     survives only under `provider.options`.
//   - dist/api/routes/callback.mjs (1.7.7: line 181)
//         disableSignUp: provider.disableImplicitSignUp && !requestSignUp || provider.options?.disableSignUp
//     reads `provider.options?.disableSignUp` -> true. CLOSED.
//   - dist/api/routes/sign-in.mjs (the ID-token branch of /sign-in/social)
//         disableSignUp: provider.disableImplicitSignUp && !c.body.requestSignUp || provider.disableSignUp
//     read `provider.disableSignUp` at the TOP LEVEL -> undefined. With an attacker-supplied
//     `requestSignUp: true` (a field of the /sign-in/social body schema; 1.7.7 sign-in.mjs:102)
//     this was `true && !true || undefined` -> falsy -> SIGN-UP PERMITTED, creating a user at the
//     schema default role `author` (packages/db-sqlite/src/schema.ts).
//
// better-auth 1.7.7 (better-auth/better-auth#11491, "ID-token sign-in ignoring the social
// provider's disableSignUp") fixed that expression: sign-in.mjs:197 now also reads
// `provider.options?.disableSignUp`. The upstream hole is closed; the origin guard stays, because
// it does not depend on that plumbing.
//
// Reachable only where the provider supports ID-token sign-in (sign-in.mjs:155-159 404s
// otherwise), which of Setu's providers is only Google, so a GitHub-only deployment was never
// affected. The attacker needs a Google ID token whose `aud` is the deployment's PUBLIC client id.
//
// So these tests assert OBSERVABLE BEHAVIOUR — did a user row appear — through a real HTTP
// request to the real better-auth handler, never the shape of the options object.
//
// WHICH guard these tests actually hold, measured on better-auth 1.7.7 (#1186) rather than
// assumed, because two walls cover this path:
//   - neuter `signupOriginGuardCreateHook` in ../src/index.ts, leave `disableSignUp` alone
//       -> the first describe's 3 tests all still PASS (since 1.7.7 better-auth's own flag stops
//          the sign-up first) and the "origin guard alone" describe's 2 tests FAIL. That second
//          block is what holds the origin guard; it was added for exactly this reason.
// Do not read a green run of the first block as evidence for the origin guard, or of either
// block as evidence that `disableSignUp` is wired in production — `apps/api/test/
// auth-social-signup.test.ts` pins that the env builder sets it.

const GOOGLE_CLIENT_ID = 'setu-test-client-id.apps.googleusercontent.com'
/** The raw Google ID-token claims the attacker legitimately holds. better-auth 1.7 types this
 *  `data` as a complete `GoogleProfile`, so the fixture now spells the whole claim set out — which
 *  suits this test, because `aud` is the finding's precondition (a token minted for THIS
 *  deployment's public client id) and it can now be stated instead of implied. */
const ATTACKER: GoogleProfile = {
  sub: 'google-uid-attacker',
  email: 'attacker@evil.example',
  name: 'Mallory',
  email_verified: true,
  aud: GOOGLE_CLIENT_ID,
  azp: GOOGLE_CLIENT_ID,
  iss: 'https://accounts.google.com',
  given_name: 'Mallory',
  family_name: 'Example',
  picture: 'https://lh3.googleusercontent.com/a/attacker',
  iat: 1_700_000_000,
  exp: 1_700_003_600
}

/** Stands in for a Google-issued ID token the attacker legitimately holds for the deployment's
 *  public client id — the exact precondition of the finding. It is an OPAQUE string on purpose:
 *  the provider's signature/JWKS check is stubbed below (`verifyIdToken`), because what is under
 *  test is what better-auth does AFTER a token verifies, not the verification itself. */
const ATTACKER_ID_TOKEN = 'attacker-google-id-token'

/** `signUpFlags: false` drops BOTH of better-auth's own sign-up flags, so the origin guard is the
 *  only thing left between the attacker and a user row — the configuration a future better-auth
 *  regression in that flag plumbing (or a new route that ignores it) would leave us with. */
function makeAuth({ signUpFlags = true }: { signUpFlags?: boolean } = {}) {
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })
  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173'],
    socialProviders: {
      google: {
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: 'setu-test-client-secret',
        disableSignUp: signUpFlags,
        disableImplicitSignUp: signUpFlags,
        // Stubs the network: @better-auth/core/dist/social-providers/google.mjs honours
        // `options.verifyIdToken` (line 95) and `options.getUserInfo` ahead of its own JWKS fetch,
        // so the test never leaves the process while still driving the REAL /sign-in/social
        // handler and the REAL sign-up decision (1.7.7 sign-in.mjs:197).
        verifyIdToken: async () => true,
        // better-auth 1.7 made `id` a `never` on the mapped user (`OAuth2UserInfo`, core's
        // src/oauth2/oauth-provider.ts: "Provider identity belongs in raw profile data and
        // `accountSubject`"), so profile mapping can no longer redefine who the provider said
        // this is. The attacker's subject therefore reaches better-auth ONLY through the raw
        // profile below — which is what a real provider response looks like, and leaves the
        // attack this file drives unchanged: it was never about the mapped id.
        getUserInfo: async () => ({
          user: {
            name: ATTACKER.name,
            email: ATTACKER.email,
            emailVerified: true
          },
          data: ATTACKER
        })
      }
    }
  })
  return { db, auth }
}

async function signInSocial(
  auth: ReturnType<typeof createAuth>,
  body: Record<string, unknown>
) {
  return await auth.handler(
    new Request('http://localhost:4444/api/auth/sign-in/social', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:5173'
      },
      body: JSON.stringify(body)
    })
  )
}

describe('OAuth cannot self-register via /sign-in/social (#645)', () => {
  it('refuses to create a user when the attacker sets requestSignUp: true', async () => {
    const { db, auth } = makeAuth()
    expect(countUsers(db)).toBe(0)

    const res = await signInSocial(auth, {
      provider: 'google',
      idToken: { token: ATTACKER_ID_TOKEN },
      // THE ATTACK. `disableImplicitSignUp` alone is defeated by this caller-supplied field;
      // `disableSignUp` was supposed to hold regardless, and on this route it did not.
      requestSignUp: true,
      callbackURL: 'http://localhost:5173/'
    })

    // The observable property that matters: no account was created.
    expect(countUsers(db), 'user rows after the attack').toBe(0)
    expect(res.ok, `status ${res.status}`).toBe(false)
  })

  it('also refuses without requestSignUp (the implicit sign-up path stays shut)', async () => {
    const { db, auth } = makeAuth()

    const res = await signInSocial(auth, {
      provider: 'google',
      idToken: { token: ATTACKER_ID_TOKEN },
      callbackURL: 'http://localhost:5173/'
    })

    expect(countUsers(db), 'user rows after implicit sign-up attempt').toBe(0)
    expect(res.ok, `status ${res.status}`).toBe(false)
  })

  it('refuses every truthy spelling of requestSignUp', async () => {
    for (const requestSignUp of [true, 1, 'true', 'yes'] as const) {
      const { db, auth } = makeAuth()
      await signInSocial(auth, {
        provider: 'google',
        idToken: { token: ATTACKER_ID_TOKEN },
        requestSignUp,
        callbackURL: 'http://localhost:5173/'
      })
      expect(
        countUsers(db),
        `user rows after requestSignUp=${JSON.stringify(requestSignUp)}`
      ).toBe(0)
    }
  })
})

// The block that actually holds signup-origin-guard.ts (see the kill-shot note in the header):
// with better-auth's own flags off, better-auth WOULD create the user, so only the
// `user.create.before` allowlist can stop it.
describe('origin guard alone refuses OAuth self-registration (#645, re-measured on 1.7.7)', () => {
  it('refuses requestSignUp: true with no better-auth sign-up flags set', async () => {
    const { db, auth } = makeAuth({ signUpFlags: false })
    const res = await signInSocial(auth, {
      provider: 'google',
      idToken: { token: ATTACKER_ID_TOKEN },
      requestSignUp: true,
      callbackURL: 'http://localhost:5173/'
    })
    expect(countUsers(db), 'user rows after the attack').toBe(0)
    expect(res.ok, `status ${res.status}`).toBe(false)
  })

  it('refuses implicit sign-up with no better-auth sign-up flags set', async () => {
    const { db, auth } = makeAuth({ signUpFlags: false })
    const res = await signInSocial(auth, {
      provider: 'google',
      idToken: { token: ATTACKER_ID_TOKEN },
      callbackURL: 'http://localhost:5173/'
    })
    expect(countUsers(db), 'user rows after implicit sign-up').toBe(0)
    expect(res.ok, `status ${res.status}`).toBe(false)
  })
})

describe('legitimate creation paths stay open under the origin guard (#645)', () => {
  // The guard must close OAuth SIGN-UP without closing the legitimate creation paths. Setu is
  // invite-only: every real user is created by first-run setup, `ensureLocalOwner`, or an
  // admin/maintainer through the admin plugin — never by an OAuth route.
  it('still lets first-run server setup create the owner', async () => {
    const db = drizzle(new Database(':memory:'))
    migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })
    const auth = createAuth({
      db,
      secret: 'test-secret-32-chars-minimum!!!!',
      baseURL: 'http://localhost:4444',
      trustedOrigins: ['http://localhost:5173'],
      serverSetup: {
        getSetupToken: () => 'test-setup-token-xyz789',
        countUsers: () => countUsers(db)
      }
    })

    const res = await auth.handler(
      new Request('http://localhost:4444/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@example.com',
          password: 'a-strong-password-12',
          name: 'Owner Person',
          token: 'test-setup-token-xyz789'
        })
      })
    )

    expect(res.status, await res.clone().text()).toBe(200)
    expect(countUsers(db), 'owner created by /setup').toBe(1)
  })
})

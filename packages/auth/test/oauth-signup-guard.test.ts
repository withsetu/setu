import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { countUsers } from '@setu/db-sqlite'
import { createAuth } from '../src'

// #645 — residual of #624. `authSocialProvidersFromEnv` sets BOTH `disableSignUp: true` and
// `disableImplicitSignUp: true` on every provider, and #624's test asserted exactly that: the
// flags are present on the config object. That assertion is about CONFIGURATION SHAPE, which is
// why this stayed open for a year — the flags were set, and one of the two routes that reads them
// never saw `disableSignUp` at all.
//
// Verified in the INSTALLED better-auth 1.6.23 (file:line, read — not assumed):
//   - dist/context/create-context.mjs:102-103
//         const provider = socialProviders[key](config);
//         provider.disableImplicitSignUp = config.disableImplicitSignUp;
//     ONLY `disableImplicitSignUp` is hoisted to the provider's top level. `disableSignUp` is
//     never hoisted, and no provider factory sets it — @better-auth/core/dist/social-providers/
//     google.mjs returns `{ id, name, ..., options }` with NO spread of `options`, so the config
//     survives only under `provider.options`.
//   - dist/api/routes/callback.mjs:150
//         disableSignUp: provider.disableImplicitSignUp && !requestSignUp || provider.options?.disableSignUp
//     reads `provider.options?.disableSignUp` -> true. CLOSED.
//   - dist/api/routes/sign-in.mjs:115
//         disableSignUp: provider.disableImplicitSignUp && !c.body.requestSignUp || provider.disableSignUp
//     reads `provider.disableSignUp` at the TOP LEVEL -> undefined. With an attacker-supplied
//     `requestSignUp: true` (a field of the /sign-in/social body schema, sign-in.mjs:35) this is
//     `true && !true || undefined` -> falsy -> SIGN-UP PERMITTED, creating a user at the schema
//     default role `author` (packages/db-sqlite/src/schema.ts).
//
// Reachable whenever Google is configured: sign-in.mjs:76-79 requires `provider.verifyIdToken`,
// which only the Google provider supplies, so a GitHub-only deployment is unaffected. The
// attacker needs a Google ID token whose `aud` is the deployment's PUBLIC client id.
//
// So these tests assert OBSERVABLE BEHAVIOUR — did a user row appear — through a real HTTP
// request to the real better-auth handler, never the shape of the options object.

const GOOGLE_CLIENT_ID = 'setu-test-client-id.apps.googleusercontent.com'
const ATTACKER = {
  sub: 'google-uid-attacker',
  email: 'attacker@evil.example',
  name: 'Mallory',
  email_verified: true
}

/** Stands in for a Google-issued ID token the attacker legitimately holds for the deployment's
 *  public client id — the exact precondition of the finding. It is an OPAQUE string on purpose:
 *  the provider's signature/JWKS check is stubbed below (`verifyIdToken`), because what is under
 *  test is what better-auth does AFTER a token verifies, not the verification itself. */
const ATTACKER_ID_TOKEN = 'attacker-google-id-token'

function makeAuth() {
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
        disableSignUp: true,
        disableImplicitSignUp: true,
        // Stubs the network: @better-auth/core/dist/social-providers/google.mjs honours
        // `options.verifyIdToken` (line 95) and `options.getUserInfo` (line 106) ahead of its own
        // JWKS fetch, so the test never leaves the process while still driving the REAL
        // /sign-in/social handler and the REAL sign-up decision at sign-in.mjs:115.
        verifyIdToken: async () => true,
        getUserInfo: async () => ({
          user: {
            id: ATTACKER.sub,
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

import type { Hono } from 'hono'
import type { AuthEvent } from '@setu/auth'

/** #248 Task 9: `login.failure` audit event — the ONE event type that cannot be observed through
 *  any better-auth `databaseHooks` chokepoint. Verified against installed better-auth 1.6.23
 *  source (dist/api/routes/sign-in.mjs): every failure path (user not found, no credential
 *  account, wrong password, unverified email, session-creation failure) `throw`s an `APIError`
 *  directly from the route handler BEFORE `internalAdapter.createSession` is ever called — so
 *  `databaseHooks.session.create.after` (the hook `login.success` uses, see
 *  packages/auth/src/audit-hooks.ts) never fires for a failed attempt. There is no `hooks.after`
 *  surface in better-auth's public options that runs on the error path either (`databaseHooks` is
 *  the only lifecycle surface, and it is DB-operation-shaped, not request/response-shaped).
 *
 *  This is the pre-approved fallback (Task 9 brief): a thin wrapper at the Hono mount point that
 *  inspects the RESPONSE of `POST /api/auth/sign-in/email` for `status >= 400` and emits
 *  `login.failure`. It reads ONLY the response status — never the request or response body — so
 *  no password or token can leak through this path. `targetId`/`actorId` are both omitted: at this
 *  wrapper layer there's no reliable non-secret way to know WHICH account was targeted without
 *  reading the request body (the email is not a secret, but parsing/logging arbitrary request
 *  bodies here would reopen exactly the risk this note just closed off; better-auth's rate limiter
 *  already keyed on this path is the existing mitigation for repeated-guess abuse — see
 *  createAuth's `customRules['/sign-in/email']`).
 *
 *  Only this one path is special-cased — every other `/api/auth/*` 4xx/5xx (e.g. a duplicate-email
 *  sign-up rejection) is DELIBERATELY not reported as `login.failure`; it isn't a login attempt at
 *  all, and misclassifying it would make the audit log noisy/misleading. */
const SIGN_IN_EMAIL_PATH = '/api/auth/sign-in/email'

export function mountAuthWithFailureEvents(
  app: Hono,
  auth: { handler: (req: Request) => Promise<Response> },
  onAuthEvent: (event: AuthEvent) => void
): void {
  app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
    const res = await auth.handler(c.req.raw)
    if (
      c.req.method === 'POST' &&
      new URL(c.req.url).pathname === SIGN_IN_EMAIL_PATH &&
      res.status >= 400
    ) {
      onAuthEvent({ type: 'login.failure' })
    }
    return res
  })
}

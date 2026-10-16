import type { Context, Env, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { CLIENT_IP_HEADER, type AuthEvent } from '@setu/auth'

/** #248 Task 9: `login.failure` audit event — the ONE event type that cannot be observed through
 *  any better-auth `databaseHooks` chokepoint. Verified against installed better-auth 1.6.23
 *  source and re-verified on 1.7.7 (dist/api/routes/sign-in.mjs lines 316-356): every failure
 *  path (password over `maxPasswordLength` — new in 1.7.6 —, user not found, no credential
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

/** #1275: the request-body cap in front of every `/api/auth/*` route, enforced BEFORE better-auth
 *  reads or parses anything. Every body better-auth accepts from Setu's admin is a small JSON
 *  object (credentials, a profile name, a reset token, a role) — kilobytes at most — so 64 KiB is
 *  generous headroom for a legitimate client while bounding what one unauthenticated request can
 *  make the server buffer. Hono's `bodyLimit` rejects on `content-length` when present and
 *  otherwise counts a streamed body chunk by chunk, stopping at the cap. Both paths are pinned by
 *  apps/api/test/auth-mount-bounds.test.ts ("refuses an oversized sign-in body",
 *  "refuses an oversized STREAMED body"). */
export const AUTH_MAX_BODY_BYTES = 64 * 1024

export interface AuthMountOptions {
  onAuthEvent: (event: AuthEvent) => void
  /** #1274: the client address better-auth may key its rate limiter (and record on the session)
   *  on, resolved by Setu's trust model — server.ts passes `resolveClientIp` (apps/api/src/client-ip.ts)
   *  over the socket peer and SETU_TRUSTED_PROXIES, the same resolution the forms submit limiter
   *  uses. Injected because reading the peer is topology-specific: a Workers entrypoint has no
   *  socket and would pass a reader for its platform-set address instead. Undefined = unknown, and
   *  better-auth then falls back to ONE shared bucket (`no-trusted-ip`) — fail-closed, never
   *  unlimited. */
  clientIp: (c: Context) => string | undefined
}

/** #1274: hand better-auth a request whose `CLIENT_IP_HEADER` is exactly the address Setu
 *  resolved — every inbound copy removed first, so a client-supplied value can never be the one
 *  better-auth reads (pinned by apps/api/test/auth-mount-bounds.test.ts, "a client-supplied
 *  x-setu-client-ip … is replaced, not believed"). A new Request rather than mutating the inbound
 *  one: a runtime's incoming-request headers may be immutable. */
function withResolvedClientIp(raw: Request, ip: string | undefined): Request {
  const headers = new Headers(raw.headers)
  headers.delete(CLIENT_IP_HEADER)
  if (ip !== undefined) headers.set(CLIENT_IP_HEADER, ip)
  // `duplex` is required by the fetch spec whenever the body is a stream (the same construction
  // hono/body-limit itself uses when it re-wraps a counted body).
  return new Request(raw, {
    headers,
    ...(raw.body ? { duplex: 'half' } : {})
  })
}

export function mountAuthWithFailureEvents<E extends Env>(
  app: Hono<E>,
  auth: { handler: (req: Request) => Promise<Response> },
  opts: AuthMountOptions
): void {
  app.on(
    ['POST', 'GET'],
    '/api/auth/*',
    // #1275: first, so an oversized body is refused before any auth work.
    bodyLimit({
      maxSize: AUTH_MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'payload too large' }, 413)
    }),
    async (c) => {
      const res = await auth.handler(
        withResolvedClientIp(c.req.raw, opts.clientIp(c))
      )
      if (
        c.req.method === 'POST' &&
        new URL(c.req.url).pathname === SIGN_IN_EMAIL_PATH &&
        res.status >= 400
      ) {
        opts.onAuthEvent({ type: 'login.failure' })
      }
      return res
    }
  )
}

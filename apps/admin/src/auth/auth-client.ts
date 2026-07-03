import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'

const apiBase = (import.meta.env.VITE_SETU_API as string | undefined) ?? ''

interface SessionUser {
  id: string
  email: string
  name?: string | null
  image?: string | null
  role?: string | null
}

/** Minimal shape of a better-auth/better-fetch error this app actually reads (LoginScreen's error
 *  mapping — status + code + message). Deliberately NOT the real `BetterFetchError` type — see
 *  the SetuAuthClient comment below for why. */
export interface AuthClientError {
  status?: number
  code?: string
  message?: string
}

interface SessionValue {
  data: { user: SessionUser } | null
  isPending: boolean
  isRefetching: boolean
  error: AuthClientError | null
  refetch: (queryParams?: { query?: Record<string, unknown> }) => Promise<void>
}

/** The shape of the client this app actually consumes — SessionGate, LoginScreen, UserMenu.
 *  Deliberately narrow rather than `ReturnType<typeof createAuthClient<typeof options>>`: the
 *  `adminClient` plugin's full inferred type embeds zod-4 schema internals (admin's role/access-
 *  control option types), which the admin package (on zod 3 — the shared @setu/core Zod version)
 *  cannot NAME in a portable way; `tsc` errors with "cannot be named without a reference to
 *  .../zod/v4/core" if the export type is left to inference. This mirrors the same narrowing
 *  pattern apps/api/src/auth/resolve-session-actor.ts already uses for AuthInstance's session
 *  type, for the same underlying reason (plugin-inferred types leaking implementation details
 *  that don't survive a package boundary). */
export interface SetuAuthClient {
  useSession: () => SessionValue
  signIn: {
    // The second positional arg is a `@better-fetch/fetch` options object — better-auth docs and
    // this codebase call it "fetchOptions" by convention, but it is passed directly here (not
    // nested under a `fetchOptions` key); `headers` on it becomes real request headers, which is
    // how the captcha token (`x-captcha-response`) reaches the server on sign-in.
    email: (
      data: { email: string; password: string },
      fetchOptions?: { headers?: Record<string, string> },
    ) => Promise<{ data: unknown; error: AuthClientError | null }>
    social: (data: { provider: 'github' | 'google' }) => Promise<{ data: unknown; error: AuthClientError | null }>
  }
  signOut: () => Promise<{ data: unknown; error: AuthClientError | null }>
  admin: unknown
}

/** The admin's Better Auth client (#248 Task 6). `baseURL` points at the api's mounted
 *  `/api/auth/*` handler (see apps/api/src/server.ts — createAuth's basePath). better-auth's
 *  client REQUIRES an absolute (http/https) URL when `baseURL` is a string at all — a relative
 *  path throws `BetterAuthError: Invalid base URL`. So when VITE_SETU_API is unset (the
 *  no-API in-browser topology — see Bootstrap.tsx — or a same-origin deployment), we omit
 *  `baseURL` entirely and let better-auth fall back to `window.location.origin` itself, rather
 *  than construct a relative string it would reject.
 *
 *  The `adminClient` plugin is wired now (rather than left for Task 8) because it must match the
 *  server's `admin` plugin registration one-for-one; Task 8 (user management) just calls the
 *  actions this already exposes (authClient.admin.*) — nothing to add here later.
 *
 *  This client manages its own credentials (cookies) independently of apiFetch (lib/api-fetch.ts)
 *  — better-fetch, which better-auth is built on, already sends credentials for same-site/cross-site
 *  requests appropriately for an auth flow; it is not routed through our apiFetch choke point. */
export const authClient: SetuAuthClient = createAuthClient({
  ...(apiBase ? { baseURL: `${apiBase}/api/auth` } : {}),
  plugins: [adminClient()],
})

export const useSession = authClient.useSession

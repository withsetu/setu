import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'

const apiBase = import.meta.env.VITE_SETU_API ?? ''

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

/** A user row as returned by the admin plugin's `listUsers`/`createUser`/`setRole`/`banUser`
 *  endpoints (better-auth 1.6.23's `UserWithRole`, narrowed to the fields this app reads — see the
 *  SetuAuthClient comment below for why this file hand-narrows rather than inferring). Dates arrive
 *  as real `Date` instances: better-auth's client fetch plugin JSON-revives ISO date strings before
 *  handing the response back (see `dist/client/parser` in the installed package) — but callers of
 *  this type should not depend on that too tightly; formatting code should defend against a raw
 *  string turning up (e.g. a mocked response in a test).
 */
export interface AdminUser {
  id: string
  email: string
  name: string
  image?: string | null
  emailVerified: boolean
  createdAt: Date | string
  updatedAt: Date | string
  role?: string | null
  banned?: boolean | null
  banReason?: string | null
  banExpires?: Date | string | null
}

export interface AdminClientSurface {
  listUsers: (data: {
    query: {
      limit?: number
      offset?: number
      sortBy?: string
      sortDirection?: 'asc' | 'desc'
      searchValue?: string
      searchField?: 'email' | 'name'
    }
  }) => Promise<{
    data: { users: AdminUser[]; total: number } | null
    error: AuthClientError | null
  }>
  createUser: (data: {
    email: string
    password: string
    name: string
    role?: string | string[]
  }) => Promise<{
    data: { user: AdminUser } | null
    error: AuthClientError | null
  }>
  setRole: (data: { userId: string; role: string | string[] }) => Promise<{
    data: { user: AdminUser } | null
    error: AuthClientError | null
  }>
  banUser: (data: { userId: string; banReason?: string }) => Promise<{
    data: { user: AdminUser } | null
    error: AuthClientError | null
  }>
  unbanUser: (data: { userId: string }) => Promise<{
    data: { user: AdminUser } | null
    error: AuthClientError | null
  }>
  setUserPassword: (data: { userId: string; newPassword: string }) => Promise<{
    data: { status: boolean } | null
    error: AuthClientError | null
  }>
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
      fetchOptions?: { headers?: Record<string, string> }
    ) => Promise<{ data: unknown; error: AuthClientError | null }>
    social: (data: {
      provider: 'github' | 'google'
    }) => Promise<{ data: unknown; error: AuthClientError | null }>
  }
  signOut: () => Promise<{ data: unknown; error: AuthClientError | null }>
  admin: AdminClientSurface
  // Base (non-plugin) better-auth client surface used by the owner-password section (Task 8):
  // `changePassword` requires the caller's current password; `listAccounts` is how we detect
  // whether the current user already has a `credential` account (i.e. "has a password" at all) —
  // see UsersScreen.tsx's `useHasPassword` for why this, rather than a new endpoint, was chosen.
  changePassword: (data: {
    newPassword: string
    currentPassword: string
    revokeOtherSessions?: boolean
  }) => Promise<{
    data: { token: string | null } | null
    error: AuthClientError | null
  }>
  listAccounts: () => Promise<{
    data: { id: string; providerId: string }[] | null
    error: AuthClientError | null
  }>
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
 *  server's `admin` plugin registration one-for-one; Task 8 (user management, UsersScreen.tsx)
 *  just calls the actions this already exposes (authClient.admin.*) — nothing to add here later.
 *  Task 8 also reads `changePassword`/`listAccounts` off the client's BASE surface (not a plugin —
 *  every better-auth client gets these for free from the core email/password + account routes).
 *
 *  This client manages its own credentials (cookies) independently of apiFetch (lib/api-fetch.ts)
 *  — better-fetch, which better-auth is built on, already sends credentials for same-site/cross-site
 *  requests appropriately for an auth flow; it is not routed through our apiFetch choke point.
 *
 *  `as unknown as SetuAuthClient` (rather than a plain type annotation): once `admin` in
 *  `SetuAuthClient` is given a concrete shape (Task 8), a plain annotation makes `tsc` structurally
 *  compare our hand-written param types against the plugin-inferred ones — and the inferred
 *  `role` param is narrowed to better-auth's OWN default admin roles (`"user" | "admin"`, since
 *  `adminClient()` here isn't told about Setu's `roles` map), which is narrower than (and rejects)
 *  the real server contract (any of Setu's five role strings — see packages/auth/src/index.ts's
 *  `setuAdminRoles`). The assertion is the intentional escape hatch already implied by this
 *  comment block: SetuAuthClient IS the source of truth for what this app may call, verified
 *  against the installed better-auth 1.6.23 source/types directly (see AdminClientSurface's and
 *  UsersScreen.tsx's comments), not inferred. */
export const authClient = createAuthClient({
  ...(apiBase ? { baseURL: `${apiBase}/api/auth` } : {}),
  plugins: [adminClient()]
}) as unknown as SetuAuthClient

export const useSession = authClient.useSession

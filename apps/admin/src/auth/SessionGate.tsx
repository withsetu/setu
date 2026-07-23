import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { canonicalRoleOf, type Role } from '@setu/core'
import { authClient } from './auth-client'
import { ActorProvider } from './actor'
import { useCapabilities } from '../lib/useCapabilities'
import { apiFetch } from '../lib/api-fetch'
import { LoginScreen } from './LoginScreen'
import { SetupScreen } from './SetupScreen'
import { ResetPasswordScreen } from './ResetPasswordScreen'
import { AuthNotConfigured } from './AuthNotConfigured'
import { Skeleton } from '@/components/ui/skeleton'

const apiBase = import.meta.env.VITE_SETU_API ?? ''

const HASH_TOKEN_RE = /^#setu-token=(.+)$/

/** Reads the one-time loopback handshake token out of `location.hash`, if present, WITHOUT
 *  scrubbing it — scrubbing happens separately (and earlier — see the invariant comment in
 *  SessionGate) so the token never lingers in the URL even if the exchange is slow. */
function readHashToken(): string | null {
  const match = HASH_TOKEN_RE.exec(window.location.hash)
  return match ? decodeURIComponent(match[1]!) : null
}

/** Mounts INSIDE the API-connected topology only. Setu also runs fully in-browser with no api
 *  (Bootstrap's no-VITE_SETU_API mode, e.g. a pure static-export preview) — in that mode there is
 *  no session, no capabilities.auth to consult, and nothing to gate: the caller should render the
 *  app directly under the existing local-owner ActorProvider default, never wrapped in this gate.
 *  That decision lives in main.tsx, not here. */
export function SessionGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const {
    auth,
    mode,
    loading: capsLoading,
    refetch: refetchCaps
  } = useCapabilities()
  const session = authClient.useSession()
  const [exchanging, setExchanging] = useState(() => readHashToken() !== null)
  const exchangeStarted = useRef(false)

  // Re-read capabilities on the signed-in → signed-out transition so `needsSetup` reflects the CURRENT
  // user count. Without this, a stale `needsSetup:true` (cached at boot when the instance had 0 users)
  // survives across logout and routes the admin to the SetupScreen instead of LoginScreen (UAT).
  const signedIn = !!session.data?.user
  const wasSignedIn = useRef(signedIn)
  useEffect(() => {
    if (wasSignedIn.current && !signedIn) void refetchCaps()
    wasSignedIn.current = signedIn
  }, [signedIn, refetchCaps])

  useEffect(() => {
    const token = readHashToken()
    if (!token || exchangeStarted.current) return
    exchangeStarted.current = true

    // INVARIANT: the hash is scrubbed via history.replaceState BEFORE awaiting the exchange
    // response — the token must not linger in the URL (visible in history/referrer/screen-share)
    // for the duration of a slow request. This mirrors the server's local-token plugin comment
    // (packages/auth/src/local-token-plugin.ts) about not letting async work widen a window where
    // sensitive state is exposed longer than necessary.
    const scrubbed = window.location.href.replace(window.location.hash, '')
    window.history.replaceState(null, '', scrubbed)

    void (async () => {
      try {
        await apiFetch(`${apiBase}/api/auth/local/exchange`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token })
        })
      } finally {
        // Whether the exchange succeeded or failed, stop showing the loading state and let
        // useSession's own value (refetched below) decide what renders next.
        void session.refetch()
        setExchanging(false)
      }
    })()
    // session.refetch is stable across better-auth's store lifetime; re-running this effect on
    // every render would re-trigger the exchange. Intentionally runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resolving = capsLoading || session.isPending || exchanging

  if (resolving) {
    return (
      <div
        className="flex min-h-svh items-center justify-center p-6"
        role="status"
        aria-live="polite"
      >
        <Skeleton className="size-10 rounded-full" />
      </div>
    )
  }

  const user = session.data?.user as
    | { id: string; role?: string | null }
    | undefined

  // #364: the emailed password-reset link's callback lands here (packages/auth/src/
  // reset-password-email.ts's default `redirectTo`, and UsersScreen.tsx's row-action trigger,
  // both point at this exact admin-origin route). It must render for a SIGNED-OUT visitor — the
  // entire point of the flow — so this check sits ahead of the needsSetup/LoginScreen fallback
  // below.
  //
  // #453: a SIGNED-IN visitor is split on whether the URL carries a reset payload. A bare visit
  // (no token, no error) used to unmount the whole app shell just to show a "missing its token"
  // card — redirect into the app instead. But a signed-in user who clicked a real emailed link
  // (token present — e.g. a passwordless maintainer who emailed themselves a reset link, #453's
  // recovery path; better-auth's `/reset-password` endpoint doesn't require a signed-out session)
  // or landed from an expired one (`?error=INVALID_TOKEN`) must still see the reset screen.
  // Covered by apps/admin/test/session-gate.test.tsx.
  if (location.pathname === '/reset-password') {
    const params = new URLSearchParams(location.search)
    const hasResetPayload = params.has('token') || params.has('error')
    if (user && !hasResetPayload) return <Navigate to="/" replace />
    return <ResetPasswordScreen />
  }
  if (user) {
    // #379: unknown/audience roles get no back-office access — the real admin.access gate is
    // deferred to #379; the server already fails closed. This UI fallback is UX-only (server
    // enforces) and uses the least-privileged staff role.
    //
    // #630: the fourth consumer of the multi-role shape, fixed for the same reason as
    // resolve-session-actor.ts — an exact match dropped a legacy `'admin,maintainer'` user to the
    // 'author' fallback, so the server (which now canonicalizes to `admin`) would grant every
    // action while this UI hid the nav and screens for all of them. `canonicalRoleOf` returns the
    // highest known component, keeping the UX gate and the server gate telling the same story.
    const role: Role = canonicalRoleOf(user.role) ?? 'author'
    return (
      <ActorProvider actor={{ id: user.id, role }}>{children}</ActorProvider>
    )
  }

  if (!auth?.enabled) return <AuthNotConfigured />
  // SetupScreen POSTs to /api/auth/setup, which is ONLY mounted in non-local topologies (local mode
  // has no setup token — packages/auth server-setup-plugin). So never route to it in local mode: a
  // signed-out local admin belongs on the LoginScreen (or the loopback handshake), not a setup form
  // whose submit can only 404.
  if (auth.needsSetup && mode !== 'local') return <SetupScreen />
  return <LoginScreen />
}

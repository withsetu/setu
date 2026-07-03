import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Role } from '@setu/core'
import { authClient } from './auth-client'
import { ActorProvider } from './actor'
import { useCapabilities } from '../lib/useCapabilities'
import { apiFetch } from '../lib/api-fetch'
import { LoginScreen } from './LoginScreen'
import { SetupScreen } from './SetupScreen'
import { AuthNotConfigured } from './AuthNotConfigured'
import { Skeleton } from '@/components/ui/skeleton'

const ROLES: readonly string[] = ['owner', 'publisher', 'editor', 'author', 'viewer']
const apiBase = (import.meta.env.VITE_SETU_API as string | undefined) ?? ''

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
  const { auth, loading: capsLoading } = useCapabilities()
  const session = authClient.useSession()
  const [exchanging, setExchanging] = useState(() => readHashToken() !== null)
  const exchangeStarted = useRef(false)

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
          body: JSON.stringify({ token }),
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
      <div className="flex min-h-svh items-center justify-center p-6" role="status" aria-live="polite">
        <Skeleton className="size-10 rounded-full" />
      </div>
    )
  }

  const user = session.data?.user as { id: string; role?: string | null } | undefined
  if (user) {
    const role: Role = ROLES.includes(user.role ?? '') ? (user.role as Role) : 'viewer'
    return <ActorProvider actor={{ id: user.id, role }}>{children}</ActorProvider>
  }

  if (!auth?.enabled) return <AuthNotConfigured />
  if (auth.needsSetup) return <SetupScreen />
  return <LoginScreen />
}

import { createContext, useCallback, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Action, Actor } from '@setu/core'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'

// Default actor for the no-API in-browser topology (Bootstrap's no-VITE_SETU_API mode — see its
// comment) and for tests: the app runs as a single local Admin with no session. When an API is
// connected, SessionGate (#248 Task 6) resolves the REAL actor from the Better Auth session and
// passes it in as the `actor` prop below — every gated action already flows through useCan(), so
// nothing downstream needed to change.
const ADMIN: Actor = { id: 'local', role: 'admin' }

const ActorContext = createContext<Actor | null>(null)

export function ActorProvider({
  actor = ADMIN,
  children
}: {
  actor?: Actor
  children: ReactNode
}) {
  return <ActorContext.Provider value={actor}>{children}</ActorContext.Provider>
}

export function useActor(): Actor {
  const ctx = useContext(ActorContext)
  if (ctx === null)
    throw new Error('useActor must be used within an ActorProvider')
  return ctx
}

/** Returns a `can(action)` bound to the current actor + the default matrix. */
export function useCan(): (action: Action) => boolean {
  const actor = useActor()
  const authz = useMemo(() => createAuthz(DEFAULT_ROLES), [])
  return useCallback(
    (action: Action) => authz.can(actor, action),
    [authz, actor]
  )
}

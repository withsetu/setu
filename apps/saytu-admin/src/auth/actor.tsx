import { createContext, useCallback, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Action, Actor } from '@saytu/core'
import { createAuthz, DEFAULT_ROLES } from '@saytu/core'

// No real auth yet — the app runs as a single Owner. Real users + auth swap this
// in later (the RBAC arc); every gated action already flows through useCan().
const OWNER: Actor = { id: 'local', role: 'owner' }

const ActorContext = createContext<Actor | null>(null)

export function ActorProvider({ actor = OWNER, children }: { actor?: Actor; children: ReactNode }) {
  return <ActorContext.Provider value={actor}>{children}</ActorContext.Provider>
}

export function useActor(): Actor {
  const ctx = useContext(ActorContext)
  if (ctx === null) throw new Error('useActor must be used within an ActorProvider')
  return ctx
}

/** Returns a `can(action)` bound to the current actor + the default matrix. */
export function useCan(): (action: Action) => boolean {
  const actor = useActor()
  const authz = useMemo(() => createAuthz(DEFAULT_ROLES), [])
  return useCallback((action: Action) => authz.can(actor, action), [authz, actor])
}

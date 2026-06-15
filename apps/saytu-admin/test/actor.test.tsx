import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ActorProvider, useActor, useCan } from '../src/auth/actor'

const wrap = ({ children }: { children: ReactNode }) => <ActorProvider>{children}</ActorProvider>

describe('actor context', () => {
  it('provides a current actor (owner by default)', () => {
    const { result } = renderHook(() => useActor(), { wrapper: wrap })
    expect(result.current.role).toBe('owner')
  })
  it('useCan gates by the actor + DEFAULT_ROLES', () => {
    const { result } = renderHook(() => useCan(), { wrapper: wrap })
    expect(result.current('content.publish')).toBe(true)
    expect(result.current('site.deploy')).toBe(true)
  })
  it('gates a non-owner actor by their role', () => {
    const viewerWrap = ({ children }: { children: ReactNode }) => (
      <ActorProvider actor={{ id: 'v', role: 'viewer' }}>{children}</ActorProvider>
    )
    const { result } = renderHook(() => useCan(), { wrapper: viewerWrap })
    expect(result.current('content.publish')).toBe(false)
    expect(result.current('site.deploy')).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ActorProvider, useActor, useCan } from '../src/auth/actor'

const wrap = ({ children }: { children: ReactNode }) => <ActorProvider>{children}</ActorProvider>

describe('actor context', () => {
  it('provides a current actor (admin by default)', () => {
    const { result } = renderHook(() => useActor(), { wrapper: wrap })
    expect(result.current.role).toBe('admin')
  })
  it('useCan gates by the actor + DEFAULT_ROLES', () => {
    const { result } = renderHook(() => useCan(), { wrapper: wrap })
    expect(result.current('content.publish')).toBe(true)
    expect(result.current('site.deploy')).toBe(true)
  })
  it('gates a non-admin actor by their role', () => {
    // #379: author is the lowest staff role — holds neither content.publish nor site.deploy.
    const authorWrap = ({ children }: { children: ReactNode }) => (
      <ActorProvider actor={{ id: 'a', role: 'author' }}>{children}</ActorProvider>
    )
    const { result } = renderHook(() => useCan(), { wrapper: authorWrap })
    expect(result.current('content.publish')).toBe(false)
    expect(result.current('site.deploy')).toBe(false)
  })
})

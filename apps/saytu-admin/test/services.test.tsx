import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ServicesProvider, createServices, useServices, useData } from '../src/data/store'

describe('services context', () => {
  it('exposes data + git + read + authoring from one provider', () => {
    const services = createServices()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServicesProvider services={services}>{children}</ServicesProvider>
    )
    const { result } = renderHook(() => useServices(), { wrapper })
    expect(typeof result.current.read.loadForEdit).toBe('function')
    expect(typeof result.current.authoring.open).toBe('function')
    expect(typeof result.current.git.headSha).toBe('function')
    expect(typeof result.current.data.listDrafts).toBe('function')
  })

  it('useData() returns the same DataPort the services bundle holds', () => {
    const services = createServices()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServicesProvider services={services}>{children}</ServicesProvider>
    )
    const { result } = renderHook(() => useData(), { wrapper })
    expect(result.current).toBe(services.data)
  })
})

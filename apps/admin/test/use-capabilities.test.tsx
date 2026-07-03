import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useCapabilities } from '../src/lib/useCapabilities'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            capabilities: {
              imageProcessing: false,
              writableMediaStore: true,
              backgroundJobs: true
            }
          }),
          { status: 200 }
        )
    )
  )
})
describe('useCapabilities', () => {
  it('fetches and exposes capability flags', async () => {
    const { result } = renderHook(() => useCapabilities())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.caps?.imageProcessing).toBe(false)
  })

  it('starts in loading state', () => {
    const { result } = renderHook(() => useCapabilities())
    expect(result.current.loading).toBe(true)
  })

  it('sets caps=null on fetch failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Network error')
      })
    )
    const { result } = renderHook(() => useCapabilities())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.caps).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
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

  it('exposes the auth capability block (#248 Task 6)', async () => {
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
              },
              auth: {
                enabled: true,
                providers: ['github'],
                captcha: null,
                needsSetup: false
              }
            }),
            { status: 200 }
          )
      )
    )
    const { result } = renderHook(() => useCapabilities())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.auth).toEqual({
      enabled: true,
      providers: ['github'],
      captcha: null,
      needsSetup: false
    })
  })

  it('sets auth=null on fetch failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Network error')
      })
    )
    const { result } = renderHook(() => useCapabilities())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.auth).toBeNull()
  })

  it('exposes the email capability block (#364)', async () => {
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
              },
              email: { transport: 'resend', deliverable: true }
            }),
            { status: 200 }
          )
      )
    )
    const { result } = renderHook(() => useCapabilities())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.email).toEqual({
      transport: 'resend',
      deliverable: true
    })
  })

  it('sets email=null on fetch failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Network error')
      })
    )
    const { result } = renderHook(() => useCapabilities())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.email).toBeNull()
  })

  // #1165: a failed read is an explicit error, never all-null data that reads as "capability off".
  describe('error state (#1165)', () => {
    it('a successful read has error=null', async () => {
      const { result } = renderHook(() => useCapabilities())
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.error).toBeNull()
    })

    it('a network failure is a network error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch')
        })
      )
      const { result } = renderHook(() => useCapabilities())
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.error).toEqual({ kind: 'network' })
    })

    it('a non-2xx response is an http error carrying the status — even with a JSON body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ auth: { enabled: false } }), {
              status: 503
            })
        )
      )
      const { result } = renderHook(() => useCapabilities())
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.error).toEqual({ kind: 'http', status: 503 })
      expect(result.current.auth).toBeNull()
    })

    it('an unparseable 2xx body is a malformed error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('<html>proxy</html>', { status: 200 }))
      )
      const { result } = renderHook(() => useCapabilities())
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.error).toEqual({ kind: 'malformed' })
    })

    it('a 2xx JSON body that is not an object is a malformed error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('null', { status: 200 }))
      )
      const { result } = renderHook(() => useCapabilities())
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.error).toEqual({ kind: 'malformed' })
    })

    it('refetch after a failure clears the error and exposes the data', async () => {
      const fetchMock = vi.fn<() => Promise<Response>>(async () => {
        throw new TypeError('Failed to fetch')
      })
      vi.stubGlobal('fetch', fetchMock)
      const { result } = renderHook(() => useCapabilities())
      await waitFor(() => expect(result.current.error).not.toBeNull())
      fetchMock.mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              capabilities: {
                imageProcessing: true,
                writableMediaStore: true,
                backgroundJobs: true
              }
            }),
            { status: 200 }
          )
      )
      await act(() => result.current.refetch())
      expect(result.current.error).toBeNull()
      expect(result.current.caps?.imageProcessing).toBe(true)
    })

    it('a slow older request cannot overwrite a newer one', async () => {
      let releaseFirst!: () => void
      let call = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          call += 1
          if (call === 1) {
            await new Promise<void>((r) => {
              releaseFirst = r
            })
            throw new TypeError('Failed to fetch')
          }
          return new Response(JSON.stringify({ mode: 'local' }), {
            status: 200
          })
        })
      )
      const { result } = renderHook(() => useCapabilities())
      await act(() => result.current.refetch())
      expect(result.current.mode).toBe('local')
      await act(async () => {
        releaseFirst()
        await Promise.resolve()
      })
      expect(result.current.error).toBeNull()
      expect(result.current.mode).toBe('local')
    })
  })
})

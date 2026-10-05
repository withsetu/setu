import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { DeployStatus } from '@setu/core'
import { DeployProvider, useDeploy } from '../src/deploy/deploy'
import { DeployOutcomeUnknownError } from '../src/deploy/deploy-errors'

const statusOf = (over: Partial<DeployStatus> = {}): DeployStatus => ({
  deployedSha: null,
  deployedAt: null,
  headSha: 'head-1',
  pending: true,
  changedPaths: [],
  job: null,
  canRebuild: true,
  rebuildBlockedReason: null,
  baselineUnresolvable: false,
  ...over
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

const wrapper = ({ children }: { children: ReactNode }) => (
  <DeployProvider>{children}</DeployProvider>
)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('DeployProvider (server-backed, #208/#209)', () => {
  it('loads server status on mount and exposes deployInfo in core shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          statusOf({
            deployedSha: 'abc',
            pending: true,
            changedPaths: [{ path: 'content/post/en/a.mdoc', added: false }]
          })
        )
      )
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    await waitFor(() => expect(result.current.status).not.toBeNull())
    expect(result.current.status?.deployedSha).toBe('abc')
    expect(result.current.deployInfo()).toEqual({
      deployedSha: 'abc',
      changed: [{ path: 'content/post/en/a.mdoc', added: false }]
    })
  })

  it('degrades to null status when the API is absent or denies (no deploy UI)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'forbidden' }, 403))
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    await act(async () => {})
    expect(result.current.status).toBeNull()
    expect(result.current.deployInfo()).toEqual({
      deployedSha: null,
      changed: []
    })
  })

  it('rebuild() posts, polls until the job finishes, and updates status', async () => {
    vi.useFakeTimers()
    let phase: 'running' | 'done' = 'running'
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/api/deploy/rebuild'))
        return json({ job: { id: 'j1', status: 'running' } }, 202)
      return phase === 'running'
        ? json(statusOf({ job: { id: 'j1', status: 'running' } as never }))
        : json(
            statusOf({
              deployedSha: 'new-sha',
              pending: false,
              job: { id: 'j1', status: 'done' } as never
            })
          )
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useDeploy(), { wrapper })

    let done = false
    let rebuildP: Promise<void> = Promise.resolve()
    await act(async () => {
      rebuildP = result.current.rebuild().then(() => {
        done = true
      })
      await vi.advanceTimersByTimeAsync(1600) // first poll — still running
    })
    expect(done).toBe(false)
    phase = 'done'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
      await rebuildP
    })
    expect(done).toBe(true)
    expect(result.current.status?.deployedSha).toBe('new-sha')
  })

  it('exposes running/startedAt for the duration of a rebuild (#571)', async () => {
    vi.useFakeTimers()
    let phase: 'running' | 'done' = 'running'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        if (url.endsWith('/api/deploy/rebuild'))
          return json({ job: { id: 'j1', status: 'running' } }, 202)
        return json(
          statusOf({ job: { id: 'j1', status: phase, startedAt: 5 } as never })
        )
      })
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    expect(result.current.running).toBe(false)
    expect(result.current.startedAt).toBeNull()

    let rebuildP: Promise<void> = Promise.resolve()
    await act(async () => {
      rebuildP = result.current.rebuild().catch(() => undefined)
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(result.current.running).toBe(true)
    expect(result.current.startedAt).toBeTypeOf('number')

    phase = 'done'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
      await rebuildP
    })
    expect(result.current.running).toBe(false)
    expect(result.current.startedAt).toBeNull()
  })

  it('reports running from server truth when another session started the build (#571)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          statusOf({
            job: { id: 'other', status: 'running', startedAt: 4242 } as never
          })
        )
      )
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    await waitFor(() => expect(result.current.status).not.toBeNull())
    expect(result.current.running).toBe(true)
    expect(result.current.startedAt).toBe(4242)
  })

  it('requestRebuild() only opens the confirmation — it never deploys (#571)', async () => {
    const fetchMock = vi.fn(async () => json(statusOf()))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useDeploy(), { wrapper })
    await waitFor(() => expect(result.current.status).not.toBeNull())
    expect(result.current.confirmOpen).toBe(false)

    act(() => {
      result.current.requestRebuild()
    })
    expect(result.current.confirmOpen).toBe(true)
    expect(
      fetchMock.mock.calls.some((call: unknown[]) =>
        String(call[0]).endsWith('/api/deploy/rebuild')
      )
    ).toBe(false)

    act(() => {
      result.current.closeConfirm()
    })
    expect(result.current.confirmOpen).toBe(false)
  })

  it('rebuild() rejects with the server message on 409 (capability off / running)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) =>
        String(input).endsWith('/api/deploy/rebuild')
          ? json({ error: 'A build is already running.' }, 409)
          : json(statusOf())
      )
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    await waitFor(() => expect(result.current.status).not.toBeNull())
    await expect(result.current.rebuild()).rejects.toThrow(/already running/i)
  })

  it("rebuild() rejects with the failed job's named reason, not a generic failure (#1183)", async () => {
    vi.useFakeTimers()
    const reason =
      "SETU_SITE_URL is not set, and the site build needs it. Set it in the API server's environment … (build exited with code 1)"
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) =>
        String(input).endsWith('/api/deploy/rebuild')
          ? json({ job: { id: 'j1', status: 'running' } }, 202)
          : json(
              statusOf({
                job: { id: 'j1', status: 'failed', error: reason } as never
              })
            )
      )
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    let err: unknown
    await act(async () => {
      const p = result.current.rebuild().catch((e: unknown) => {
        err = e
      })
      await vi.advanceTimersByTimeAsync(1600)
      await p
    })
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(DeployOutcomeUnknownError)
    expect((err as Error).message).toBe(reason)
    expect(result.current.running).toBe(false)
  })

  it('rebuild() rejects with DeployOutcomeUnknownError when it loses the status mid-build', async () => {
    vi.useFakeTimers()
    let down = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (String(input).endsWith('/api/deploy/rebuild'))
          return json({ job: { id: 'j1', status: 'running' } }, 202)
        if (down) throw new TypeError('Failed to fetch')
        return json(statusOf())
      })
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    down = true
    let err: unknown
    await act(async () => {
      const p = result.current.rebuild().catch((e: unknown) => {
        err = e
      })
      await vi.advanceTimersByTimeAsync(1600)
      await p
    })
    expect(err).toBeInstanceOf(DeployOutcomeUnknownError)
    expect(result.current.running).toBe(false)
  })

  it('a denied status (401/403) hides the control without an error — it is not a failure', async () => {
    for (const code of [401, 403]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => json({ error: 'no' }, code))
      )
      const { result, unmount } = renderHook(() => useDeploy(), { wrapper })
      await act(async () => {})
      expect(result.current.status).toBeNull()
      expect(result.current.loadError).toBeNull()
      unmount()
    }
  })

  it('a server failure is a visible error, not a silently missing control (#1158)', async () => {
    let ok = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (ok ? json(statusOf()) : json({ error: 'x' }, 500)))
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    await waitFor(() => expect(result.current.loadError).not.toBeNull())
    expect(result.current.loadError).toMatch(/500/)
    expect(result.current.status).toBeNull()

    // Retry recovers and clears the error.
    ok = true
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.status).not.toBeNull()
    expect(result.current.loadError).toBeNull()
  })

  it('an unreachable server is a visible error naming the connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    await waitFor(() => expect(result.current.loadError).not.toBeNull())
    expect(result.current.loadError).toMatch(/connection/i)
  })

  it('a malformed status is a visible error too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ nope: true }))
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    await waitFor(() => expect(result.current.loadError).not.toBeNull())
  })

  it('disabled (the no-api topology) never fetches and reports no error', async () => {
    const fetchMock = vi.fn(async () => json(statusOf()))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useDeploy(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <DeployProvider enabled={false}>{children}</DeployProvider>
      )
    })
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.status).toBeNull()
    expect(result.current.loadError).toBeNull()
  })

  it('accepts a zero-commit status (null HEAD) rather than treating it as malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(statusOf({ headSha: null, canRebuild: false })))
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    await waitFor(() => expect(result.current.status).not.toBeNull())
    expect(result.current.loadError).toBeNull()
  })

  it('an unresolvable baseline claims nothing is live in deployInfo (saved ≠ live)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          statusOf({
            deployedSha: 'gone-sha',
            baselineUnresolvable: true,
            changedPaths: []
          })
        )
      )
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    await waitFor(() => expect(result.current.status).not.toBeNull())
    // An empty diff against a sha we could not resolve would otherwise read as "everything
    // is live" — the inverted claim. Treat it as never deployed instead.
    expect(result.current.deployInfo()).toEqual({
      deployedSha: null,
      changed: []
    })
  })

  it("keeps polling another session's running build until it ends, then reports how (#1157)", async () => {
    vi.useFakeTimers()
    let phase: 'running' | 'failed' = 'running'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          statusOf({
            job: {
              id: 'other',
              status: phase,
              startedAt: 1,
              ...(phase === 'failed'
                ? { error: 'Interrupted by a server restart' }
                : {})
            } as never
          })
        )
      )
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.running).toBe(true)
    phase = 'failed'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(result.current.running).toBe(false)
    expect(result.current.status?.job?.status).toBe('failed')
    expect(result.current.status?.job?.error).toMatch(/server restart/)
  })
})

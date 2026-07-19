import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { DeployStatus } from '@setu/core'
import { DeployProvider, useDeploy } from '../src/deploy/deploy'

const statusOf = (over: Partial<DeployStatus> = {}): DeployStatus => ({
  deployedSha: null,
  deployedAt: null,
  headSha: 'head-1',
  pending: true,
  changedPaths: [],
  job: null,
  canRebuild: true,
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
})

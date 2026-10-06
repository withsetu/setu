import { StrictMode } from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'

// #1181: when the API is down at page load, Bootstrap must show the same can't-reach card as
// SessionGate (#1165) — plain-words cause, Retry, and a backoff auto-retry — and recover on its
// own once the API is back. These tests use the REAL @setu/git-http port against a stubbed global
// fetch, so the network / HTTP-status classification is the shipped one.

// jsdom has no IndexedDB: stand the IDB ports in with memory ones (IDB resilience is
// apps/admin/test/bootstrap.test.tsx's subject, not this file's).
vi.mock('@setu/db-idb', async () => {
  const mem = await import('@setu/db-memory')
  return {
    createIdbDataPort: vi.fn(async () => mem.createMemoryDataPort()),
    createIdbIndexPort: vi.fn(async () => mem.createMemoryIndexPort()),
    createIdbMediaIndexPort: vi.fn(async () => mem.createMemoryMediaIndexPort())
  }
})

// The no-API branch's in-memory fallback is made to fail for the "not an API outage" case.
const memoryFails = { value: false }
vi.mock('@setu/db-memory', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@setu/db-memory')>()
  return {
    ...orig,
    createMemoryDataPort: (
      ...args: Parameters<typeof orig.createMemoryDataPort>
    ) => {
      const port = orig.createMemoryDataPort(...args)
      return {
        ...port,
        listDrafts: () =>
          memoryFails.value
            ? Promise.reject(new Error('in-memory store broke'))
            : port.listDrafts()
      }
    }
  }
})

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

/** `/git/head` answers with `failure` until `recover()` is called, then with an empty repo. */
function stubApi(failure: () => Promise<Response>) {
  let healthy = false
  let headCalls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/git/head')) {
        headCalls += 1
        if (!healthy) return failure()
        return new Response(JSON.stringify({ sha: 'abc123' }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
  )
  return {
    recover: () => {
      healthy = true
    },
    calls: () => headCalls
  }
}

async function renderBootstrap() {
  const { Bootstrap } = await import('../src/data/Bootstrap')
  // StrictMode like main.tsx: its double effect run must not skip a backoff step.
  render(
    <StrictMode>
      <Bootstrap>
        <div>App rendered</div>
      </Bootstrap>
    </StrictMode>
  )
}

async function expectUnreachable(detail: RegExp) {
  expect(
    await screen.findByText(/can.t reach the setu api/i)
  ).toBeInTheDocument()
  expect(
    screen.getByText(/needs the API to load your site/i)
  ).toBeInTheDocument()
  expect(screen.getByText(detail)).toBeInTheDocument()
  expect(screen.queryByText('App rendered')).not.toBeInTheDocument()
  // Not the generic startup failure, and not blamed on local storage.
  expect(screen.queryByText(/couldn.t start/i)).not.toBeInTheDocument()
}

describe('Bootstrap — API unreachable at startup (#1181)', () => {
  let errorSpy: { mock: { calls: unknown[][] } }
  beforeEach(() => {
    vi.stubEnv('VITE_SETU_API', 'http://localhost:4444')
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    memoryFails.value = false
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("an API that doesn't answer shows the can't-reach card, not a storage warning", async () => {
    stubApi(async () => {
      throw new TypeError('Failed to fetch')
    })
    await renderBootstrap()
    await expectUnreachable(/didn.t respond/i)
    const { toast } = await import('sonner')
    expect(toast.error).not.toHaveBeenCalled()
    // The outage is not misreported as a broken IndexedDB in the console either.
    expect(
      errorSpy.mock.calls.some((c) => /indexeddb/i.test(String(c[0])))
    ).toBe(false)
  })

  it('an API error status is named', async () => {
    stubApi(async () => new Response('boom', { status: 503 }))
    await renderBootstrap()
    await expectUnreachable(/HTTP 503/)
  })

  it('Retry recovers into the app once the API is back', async () => {
    const api = stubApi(async () => {
      throw new TypeError('Failed to fetch')
    })
    await renderBootstrap()
    await expectUnreachable(/didn.t respond/i)
    api.recover()
    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }))
    expect(await screen.findByText('App rendered')).toBeInTheDocument()
    expect(
      screen.queryByText(/can.t reach the setu api/i)
    ).not.toBeInTheDocument()
  })

  it('retries automatically with backoff and recovers without a click', async () => {
    // Same deterministic-timer approach as apps/admin/test/session-gate.test.tsx: the countdown
    // is awaited with a one-second tolerance, the backoff pinned by call counts.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = stubApi(async () => {
      throw new TypeError('Failed to fetch')
    })
    await renderBootstrap()
    await expectUnreachable(/didn.t respond/i)
    expect(
      await screen.findByText(/trying again automatically in [12] s/i)
    ).toBeInTheDocument()
    const before = api.calls()
    await act(() => vi.advanceTimersByTimeAsync(2000))
    await waitFor(() => expect(api.calls()).toBe(before + 1))
    expect(
      await screen.findByText(/trying again automatically in [34] s/i)
    ).toBeInTheDocument()
    // Halfway into the 4 s step: no further attempt yet (the delay grew, it did not repeat 2 s).
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(api.calls()).toBe(before + 1)
    api.recover()
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(await screen.findByText('App rendered')).toBeInTheDocument()
  })
})

describe('Bootstrap — a startup failure that is not the API (#1181)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SETU_API', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    memoryFails.value = false
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("says Setu couldn't start — not that the API is unreachable — and Try again recovers", async () => {
    // No-API build: IndexedDB fails (degrade) AND the in-memory fallback fails too.
    const idb = await import('@setu/db-idb')
    vi.mocked(idb.createIdbDataPort).mockRejectedValueOnce(
      new Error('IDB unavailable')
    )
    memoryFails.value = true
    await renderBootstrap()
    expect(await screen.findByText(/setu couldn.t start/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/can.t reach the setu api/i)
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/trying again automatically/i)
    ).not.toBeInTheDocument()

    memoryFails.value = false
    fireEvent.click(screen.getByRole('button', { name: /^try again$/i }))
    expect(await screen.findByText('App rendered')).toBeInTheDocument()
  })
})

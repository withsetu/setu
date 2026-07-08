import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { bootstrapServices, seedDrafts } from '../src/data/store'

describe('bootstrapServices seed-on-empty', () => {
  it('seeds the sample drafts when the store is empty', async () => {
    const services = await bootstrapServices(
      createMemoryDataPort(),
      createMemoryGitPort()
    )
    const drafts = await services.data.listDrafts()
    expect(drafts).toHaveLength(seedDrafts.length)
    expect(drafts.map((d) => d.slug).sort()).toEqual(
      seedDrafts.map((d) => d.slug).sort()
    )
  })

  it('does NOT re-seed when the store already has content', async () => {
    const data = createMemoryDataPort([
      {
        collection: 'post',
        locale: 'en',
        slug: 'mine',
        content: { type: 'doc', content: [] },
        metadata: { title: 'Mine' }
      }
    ])
    const services = await bootstrapServices(data, createMemoryGitPort())
    const drafts = await services.data.listDrafts()
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.slug).toBe('mine')
  })

  it('does NOT re-seed when Git has commits but DB is empty', async () => {
    const git = createMemoryGitPort([
      { path: 'content/post/en/x.mdoc', content: '# x' }
    ])
    const services = await bootstrapServices(createMemoryDataPort(), git)
    expect(await services.data.listDrafts()).toHaveLength(0)
  })
})

// #248: Bootstrap's server-backed (apiBase) branch opens IndexedDB with no try/catch and no
// timeout — if IDB is wedged/unavailable (over-quota, private mode, corrupted), the open promise
// never resolves and the whole admin hangs forever on "Loading…" (confirmed live by the owner
// during UAT). These tests assert the fix: a bounded timeout + fallback to in-memory adapters, so
// the app always renders even when IndexedDB is broken.
vi.mock('@setu/db-idb', () => ({
  createIdbDataPort: vi.fn(),
  createIdbIndexPort: vi.fn().mockResolvedValue({
    ensureBuilt: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    distinctLocales: vi.fn().mockResolvedValue([])
  }),
  createIdbMediaIndexPort: vi.fn().mockResolvedValue({})
}))

// The apiBase fallback keeps the server-backed GitPort (only the IDB-backed pieces degrade to
// memory), and `bootstrapServices` → `seedIfEmpty` calls `git.headSha()` before it can render. The
// real `@setu/git-http` port would fire that at http://localhost:4444 — unreachable under test, so
// the fetch throws `ECONNREFUSED`, propagates out of Bootstrap's async effect unguarded, and
// `setServices` never runs (app stuck on "Loading…", no toast). That network round-trip is NOT the
// behavior these tests exercise (IDB resilience + toast ordering), so we stub the HTTP GitPort the
// same way the IDB ports above are stubbed — headSha resolves empty so seeding proceeds in-memory.
vi.mock('@setu/git-http', () => ({
  createHttpGitPort: vi.fn(() => ({
    headSha: vi.fn().mockResolvedValue(null),
    readFile: vi.fn().mockResolvedValue(null),
    commitFile: vi.fn().mockResolvedValue({ sha: 'stub' }),
    commitFiles: vi.fn().mockResolvedValue({ sha: 'stub' }),
    list: vi.fn().mockResolvedValue([])
  }))
}))

// Real `sonner` verified LIVE (not just in jsdom) that a toast() fired before `<Toaster/>` has
// ever mounted is silently dropped (sonner 2.0.7: Toaster seeds its own `toasts` state as `[]` and
// only starts receiving via `ToastState.subscribe` inside its own mount effect — zero subscribers
// at call time means the toast is simply lost, not queued). Bootstrap's fallback notice must
// therefore fire from an effect that only runs once `services` (and so `children`, and so
// `<Toaster/>`) has committed — this mock lets these tests assert that ordering directly rather
// than trusting a DOM query against the real Toaster (which would need next-themes/matchMedia
// mocked here for no real benefit — the ordering IS the contract, not sonner's own rendering).
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

describe('Bootstrap — IndexedDB resilience (server-backed / apiBase branch)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('falls back to in-memory services and still renders children when the IDB open hangs forever', async () => {
    vi.stubEnv('VITE_SETU_API', 'http://localhost:4444')
    const { createIdbDataPort } = await import('@setu/db-idb')
    vi.mocked(createIdbDataPort).mockReturnValue(new Promise(() => {}) as never) // never resolves

    const { Bootstrap } = await import('../src/data/Bootstrap')
    render(
      <Bootstrap>
        <div>App rendered</div>
      </Bootstrap>
    )

    // Real timers + a generous waitFor timeout (well above the ~5s fallback timeout) — proves
    // Bootstrap does NOT hang forever, without needing to fake-timer-advance past a Promise.race.
    await waitFor(
      () => expect(screen.getByText('App rendered')).toBeInTheDocument(),
      { timeout: 8000 }
    )
  }, 10000)

  it('falls back to in-memory services when the IDB open rejects outright, and notifies only after children have rendered', async () => {
    vi.stubEnv('VITE_SETU_API', 'http://localhost:4444')
    const { createIdbDataPort } = await import('@setu/db-idb')
    vi.mocked(createIdbDataPort).mockRejectedValue(
      new Error('IDB unavailable (private mode)')
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { toast } = await import('sonner')

    // Rather than asserting call order from OUTSIDE (which races the test's own microtask timing
    // against the component's — a synchronous `not.toHaveBeenCalled()` right after render() would
    // pass trivially whether or not the ordering bug is present, since the catch's async work
    // hasn't run yet either way), the mock's OWN implementation captures whether "App rendered" was
    // in the DOM at the exact moment toast.error was invoked. This is what actually distinguishes
    // "fired from the services-effect after commit" (correct) from "fired inline in the catch
    // block, before children ever render" (the live bug this fix addresses) regardless of timing.
    let childrenWereRenderedWhenNotified: boolean | null = null
    vi.mocked(toast.error).mockImplementation(() => {
      childrenWereRenderedWhenNotified =
        screen.queryByText('App rendered') !== null
      return ''
    })

    const { Bootstrap } = await import('../src/data/Bootstrap')
    render(
      <Bootstrap>
        <div>App rendered</div>
      </Bootstrap>
    )

    // Poll the ordering flag itself (not just "was called") — the mock impl that captures the
    // DOM state runs on the toast.error call, and on a slow CI runner the call can be recorded a
    // microtask before the impl's assignment is observable here. waitF'ing the flag makes this
    // deterministic while still failing loudly if the notify ever fires before children render.
    await waitFor(() => expect(childrenWereRenderedWhenNotified).toBe(true))
    expect(errorSpy).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/local storage is unavailable/i),
      expect.objectContaining({ description: expect.any(String) })
    )
    expect(screen.getByText('App rendered')).toBeInTheDocument()
  })
})

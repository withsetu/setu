/** Demo Data panel (#513) — jsdom contract: section controls, seed payload
 *  shape, progress rendering from polled status, reset confirms hitting the
 *  right endpoint, passwords rendered once. The api routes themselves are
 *  covered in apps/api/test/demo-api.test.ts. */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach
} from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ActorProvider } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { SettingsProvider } from '../src/data/settings-store'
import { DemoDataScreen } from '../src/screens/demo/DemoDataScreen'
import { apiFetch } from '../src/lib/api-fetch'

vi.mock('../src/lib/api-fetch', () => ({ apiFetch: vi.fn() }))
vi.mock('../src/data/reset', () => ({ resetToSampleContent: vi.fn() }))
vi.mock('../src/data/settings-store', async (importOriginal) => {
  const mod =
    await importOriginal<typeof import('../src/data/settings-store')>()
  return {
    ...mod,
    // PageHeader reads the site title; the real provider needs Services.
    useSiteTitle: () => '',
    SettingsProvider: ({ children }: { children: React.ReactNode }) => children
  }
})

const fetchMock = vi.mocked(apiFetch)

// Radix Select/AlertDialog/Slider need APIs jsdom lacks.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView ??= () => {}
  window.HTMLElement.prototype.hasPointerCapture ??= () => false
  window.HTMLElement.prototype.releasePointerCapture ??= () => {}
  // Radix Slider measures itself via ResizeObserver (same shim as CommandPalette tests)
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

type Json = Record<string, unknown>
const ok = (body: Json): Response =>
  ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body)
  }) as unknown as Response

const idleStatus = (dataset: Json = { present: true, kind: 'dump' }): Json => ({
  dataset,
  job: null
})

const runningSeed = (over: Json = {}): Json => ({
  dataset: { present: true, kind: 'dump' },
  job: {
    id: 'job-1',
    kind: 'seed',
    status: 'running',
    phase: 'images',
    done: 3,
    total: 10,
    imageFailures: 2,
    warnings: [],
    cancellable: true,
    startedAt: 1,
    ...over
  }
})

/** Route every apiFetch by URL+method; GET /status serves from a mutable queue. */
function mockApi(statusResponses: Json[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  fetchMock.mockImplementation((input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    calls.push({ url, ...(init ? { init } : {}) })
    if (url.endsWith('/api/demo/status')) {
      const next =
        statusResponses.length > 1
          ? statusResponses.shift()!
          : statusResponses[0]!
      return Promise.resolve(ok(next))
    }
    return Promise.resolve(ok({ id: 'job-new' }))
  })
  return calls
}

const renderScreen = () =>
  render(
    <MemoryRouter>
      <ActorProvider>
        <NotificationProvider>
          <SettingsProvider>
            <DemoDataScreen />
          </SettingsProvider>
        </NotificationProvider>
      </ActorProvider>
    </MemoryRouter>
  )

beforeEach(() => {
  vi.stubEnv('DEV', true)
  vi.stubEnv('VITE_SETU_API', 'http://api.test')
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('environment gating', () => {
  it('shows an honest message instead of the panel when the dev API env is missing', () => {
    vi.stubEnv('VITE_SETU_API', '')
    renderScreen()
    expect(screen.getByText(/Demo data needs the dev API/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('sections', () => {
  it('renders every section with its controls (pack select, per-role inputs, presets, slider, switch)', async () => {
    mockApi([idleStatus()])
    renderScreen()
    await screen.findByText('Dataset ready — full data dump found locally.')

    // Dataset: the pack picker is a Select, not a raw text box
    expect(
      screen.getByRole('combobox', { name: /content pack/i })
    ).toBeInTheDocument()
    expect(screen.getByText('Art Institute of Chicago')).toBeInTheDocument()

    // Users: per-role inputs with the agreed defaults
    expect(screen.getByLabelText('Admins')).toHaveValue('1')
    expect(screen.getByLabelText('Maintainers')).toHaveValue('1')
    expect(screen.getByLabelText('Editors')).toHaveValue('2')
    expect(screen.getByLabelText('Authors')).toHaveValue('5')

    // Content: the four presets + custom input (default ~1k), slider, switch
    for (const label of ['50', '1,000', '10,000', '30,000'])
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1,000' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    // NOTE: the shared ui/slider renders its thumb without a name (repo-wide
    // limitation, same as editor SliderControl) — assert presence by role.
    expect(screen.getByRole('slider')).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: /relax text quality/i })
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/limit images/i)).toBeInTheDocument()

    // Seed + Reset
    expect(
      screen.getByRole('button', { name: 'Seed demo content' })
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Remove generated' })
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Reset to sample' })
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Erase everything' })
    ).toBeEnabled()
  })

  it('offers the sized download affordance when the dataset is missing, and disables Seed', async () => {
    mockApi([idleStatus({ present: false, kind: null })])
    renderScreen()
    const download = await screen.findByRole('button', {
      name: /download dataset \(~115 MiB\)/i
    })
    expect(download).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Seed demo content' })
    ).toBeDisabled()

    fireEvent.click(download)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://api.test/api/demo/fetch-dump',
        expect.objectContaining({ method: 'POST' })
      )
    )
  })
})

describe('seeding', () => {
  it('posts the configured payload shape', async () => {
    const calls = mockApi([idleStatus()])
    renderScreen()
    await screen.findByRole('button', { name: 'Seed demo content' })

    fireEvent.click(screen.getByRole('button', { name: '50' }))
    fireEvent.change(screen.getByLabelText('Authors'), {
      target: { value: '3' }
    })
    fireEvent.click(screen.getByRole('switch', { name: /relax text quality/i }))
    fireEvent.change(screen.getByLabelText(/limit images/i), {
      target: { value: '25' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Seed demo content' }))

    await waitFor(() => {
      const seed = calls.find((c) => c.url.endsWith('/api/demo/seed'))
      expect(seed).toBeDefined()
      expect(JSON.parse(seed!.init!.body as string)).toEqual({
        posts: 50,
        users: { admin: 1, maintainer: 1, editor: 2, author: 3 },
        draftFraction: 0.1,
        relaxText: true,
        limitImages: 25
      })
    })
  })

  it('rejects an over-cap post count with a per-field error and no request', async () => {
    const calls = mockApi([idleStatus()])
    renderScreen()
    await screen.findByRole('button', { name: 'Seed demo content' })
    fireEvent.change(
      screen.getByRole('textbox', { name: /custom post count/i }),
      {
        target: { value: '30001' }
      }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Seed demo content' }))
    expect(
      await screen.findByText(/whole number up to 30,000/i)
    ).toBeInTheDocument()
    expect(calls.some((c) => c.url.endsWith('/api/demo/seed'))).toBe(false)
  })

  it('renders live progress (phase, n/total, image failures) and a working Cancel', async () => {
    const calls = mockApi([runningSeed()])
    renderScreen()
    expect(await screen.findByText('Downloading images')).toBeInTheDocument()
    expect(screen.getByText('3 / 10')).toBeInTheDocument()
    expect(
      screen.getByText(/2 image downloads failed so far/)
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/api/demo/cancel'))).toBe(true)
    )
  })

  it('shows passwords once after a watched seed completes, and dismiss removes them', async () => {
    const done = {
      dataset: { present: true, kind: 'dump' },
      job: {
        ...(runningSeed()['job'] as Json),
        status: 'done',
        phase: 'posts',
        done: 10,
        total: 10,
        seedSummary: {
          users: [
            {
              email: 'demo-admin-1@demo.setu.test',
              role: 'admin',
              password: 'pw-abc'
            },
            {
              email: 'demo-author-1@demo.setu.test',
              role: 'author',
              password: null
            }
          ],
          posts: 10,
          images: 8,
          imagesReused: 0,
          imageFailures: 2,
          commits: 3,
          skipped: {},
          durationMs: 4200
        }
      }
    }
    // first poll: running; the next: done → a WATCHED transition
    mockApi([runningSeed(), done])
    renderScreen()
    await screen.findByText('Downloading images')

    expect(
      await screen.findByText('Demo user credentials — shown once', undefined, {
        timeout: 3000
      })
    ).toBeInTheDocument()
    expect(screen.getByText('pw-abc')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /copy password for demo-admin-1/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/password unchanged \(already existed\)/)
    ).toBeInTheDocument()

    const region = screen.getByRole('region', { name: 'Demo user credentials' })
    fireEvent.click(within(region).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('pw-abc')).not.toBeInTheDocument()
  })

  it('never shows passwords for a stale terminal job found on first load', async () => {
    const staleDone = {
      dataset: { present: true, kind: 'dump' },
      job: {
        ...(runningSeed()['job'] as Json),
        status: 'done',
        seedSummary: {
          users: [
            {
              email: 'demo-admin-1@demo.setu.test',
              role: 'admin',
              password: 'pw-old'
            }
          ],
          posts: 1,
          images: 0,
          imagesReused: 0,
          imageFailures: 0,
          commits: 1,
          skipped: {},
          durationMs: 1
        }
      }
    }
    mockApi([staleDone])
    renderScreen()
    await screen.findByRole('button', { name: 'Seed demo content' })
    expect(screen.queryByText('pw-old')).not.toBeInTheDocument()
  })
})

describe('reset levels', () => {
  const openAndConfirm = async (buttonName: string, expectSurvives: RegExp) => {
    fireEvent.click(screen.getByRole('button', { name: buttonName }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(expectSurvives)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: buttonName }))
  }

  it.each([
    [
      'Remove generated',
      'generated',
      /hand-made content, your uploads, your account/i
    ],
    [
      'Reset to sample',
      'sample',
      /your account, site settings, and hand-uploaded media/i
    ],
    ['Erase everything', 'zero', /you stay signed in/i]
  ] as const)(
    '%s confirms with explicit survivors and posts level=%s',
    async (buttonName, level, survives) => {
      const calls = mockApi([idleStatus()])
      renderScreen()
      await screen.findByRole('button', { name: buttonName })
      await openAndConfirm(buttonName, survives)
      await waitFor(() => {
        const unseed = calls.find((c) => c.url.endsWith('/api/demo/unseed'))
        expect(unseed).toBeDefined()
        expect(JSON.parse(unseed!.init!.body as string)).toEqual({ level })
      })
    }
  )
})

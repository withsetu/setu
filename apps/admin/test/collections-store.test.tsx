import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import {
  CollectionsProvider,
  useCollections
} from '../src/data/collections-store'

const fetchMock = vi.fn()
vi.mock('@/lib/api-fetch', () => ({
  apiFetch: (...args: unknown[]) => fetchMock(...args) as unknown
}))

function Probe() {
  const { collections, loading, failed } = useCollections()
  return (
    <div>
      <span data-testid="names">
        {collections.map((c) => c.name).join(',')}
      </span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="failed">{String(failed)}</span>
    </div>
  )
}

const renderProbe = () =>
  render(
    <CollectionsProvider>
      <Probe />
    </CollectionsProvider>
  )

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body)
})

beforeEach(() => fetchMock.mockReset())
afterEach(() => vi.restoreAllMocks())

describe('CollectionsProvider', () => {
  it('publishes the declared collections once the read settles', async () => {
    fetchMock.mockResolvedValue(
      ok({
        collections: [
          { name: 'post', label: 'Post', labelPlural: 'Posts', taxonomies: [] },
          {
            name: 'product',
            label: 'Product',
            labelPlural: 'Products',
            taxonomies: []
          }
        ]
      })
    )
    renderProbe()
    await waitFor(() =>
      expect(screen.getByTestId('names').textContent).toBe('post,product')
    )
    expect(screen.getByTestId('failed').textContent).toBe('false')
    expect(screen.getByTestId('loading').textContent).toBe('false')
  })

  // Loading is not "only the built-ins", and a failed read is not "this site has two
  // collections" — the flags are what let a consumer tell those apart (§4 row 22).
  it('falls back to the built-ins AND raises failed when the read rejects', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    renderProbe()
    await waitFor(() =>
      expect(screen.getByTestId('failed').textContent).toBe('true')
    )
    expect(screen.getByTestId('names').textContent).toBe('post,page')
    expect(screen.getByTestId('loading').textContent).toBe('false')
  })

  it('treats a non-ok response as a failure rather than an empty set', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({})
    })
    renderProbe()
    await waitFor(() =>
      expect(screen.getByTestId('failed').textContent).toBe('true')
    )
    expect(screen.getByTestId('names').textContent).toBe('post,page')
  })

  it('treats a malformed body as a failure rather than blanking the list', async () => {
    fetchMock.mockResolvedValue(ok({ collections: 'nope' }))
    renderProbe()
    await waitFor(() =>
      expect(screen.getByTestId('failed').textContent).toBe('true')
    )
    expect(screen.getByTestId('names').textContent).toBe('post,page')
  })

  it('degrades to the built-ins outside a provider instead of throwing', () => {
    render(<Probe />)
    expect(screen.getByTestId('names').textContent).toBe('post,page')
    expect(screen.getByTestId('failed').textContent).toBe('false')
  })
})

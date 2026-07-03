import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiFetch } from '../src/lib/api-fetch'

afterEach(() => vi.restoreAllMocks())

describe('apiFetch', () => {
  it('always sends credentials: include, even when called with no init', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    await apiFetch('http://x/api/capabilities')
    expect(f).toHaveBeenCalledWith('http://x/api/capabilities', { credentials: 'include' })
  })

  it('preserves caller-supplied init while forcing credentials: include', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    await apiFetch('http://x/media', { method: 'DELETE', headers: { a: '1' } })
    expect(f).toHaveBeenCalledWith('http://x/media', {
      method: 'DELETE',
      headers: { a: '1' },
      credentials: 'include',
    })
  })

  it('does not let caller override credentials to omit', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    await apiFetch('http://x/media', { credentials: 'omit' })
    expect(f).toHaveBeenCalledWith('http://x/media', { credentials: 'include' })
  })
})

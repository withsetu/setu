import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPreviewDraft } from '../src/preview/load-draft'

/**
 * #1123 — the preview route used to collapse five outcomes into "Nothing to preview yet".
 * `loadPreviewDraft` is the classifier preview.astro renders from: ONLY a genuine no-draft is
 * `empty`; every failure is an `error` with a plain-words reason. One case per outcome.
 *
 * The genuine-empty marker (`empty: true` on the 404 body) is the api's half of the contract,
 * pinned on that side by apps/api/test/preview.test.ts.
 */
const API = 'http://api.test'
const draft = {
  content: '---\ntitle: Hi\n---\nHello',
  collection: 'post',
  locale: 'en',
  slug: 'hi'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
const stub = (impl: () => Promise<Response>) =>
  vi.fn<typeof fetch>(() => impl())

afterEach(() => vi.restoreAllMocks())

describe('loadPreviewDraft (#1123)', () => {
  it('a pushed draft → draft', async () => {
    const r = await loadPreviewDraft(
      API,
      stub(async () => json(draft))
    )
    expect(r).toEqual({ kind: 'draft', draft })
  })

  it('1 · genuinely no draft (404 + empty marker) → empty, and does not warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await loadPreviewDraft(
      API,
      stub(async () => json({ error: 'no preview draft', empty: true }, 404))
    )
    expect(r).toEqual({ kind: 'empty' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('2 · api unreachable (fetch rejects) → error "unreachable", naming the url, and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await loadPreviewDraft(
      API,
      stub(async () => {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })
        })
      })
    )
    expect(r).toMatchObject({ kind: 'error', reason: 'unreachable' })
    expect(r.kind === 'error' && r.message).toContain(API)
    expect(warn).toHaveBeenCalledOnce()
    // One line naming the underlying cause, not a stack dump per reload.
    expect(warn.mock.calls[0]).toHaveLength(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('ECONNREFUSED')
  })

  it('3 · a 5xx → error "server", naming the status', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await loadPreviewDraft(
      API,
      stub(async () => json({ error: 'internal error' }, 503))
    )
    expect(r).toMatchObject({ kind: 'error', reason: 'server' })
    expect(r.kind === 'error' && r.message).toContain('503')
  })

  it('4 · preview route absent (bare 404, no empty marker) → error "disabled", not empty', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await loadPreviewDraft(
      API,
      stub(async () => new Response('404 Not Found', { status: 404 }))
    )
    expect(r).toMatchObject({ kind: 'error', reason: 'disabled' })
  })

  it('4b · a 404 whose JSON body lacks the marker is still "disabled"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await loadPreviewDraft(
      API,
      stub(async () => json({ error: 'not found' }, 404))
    )
    expect(r).toMatchObject({ kind: 'error', reason: 'disabled' })
  })

  it('5 · a truncated body (JSON parse fails) → error "malformed"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await loadPreviewDraft(
      API,
      stub(async () => new Response('{"content":"---\\ntit', { status: 200 }))
    )
    expect(r).toMatchObject({ kind: 'error', reason: 'malformed' })
  })

  it('5b · valid JSON of the wrong shape → error "malformed"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await loadPreviewDraft(
      API,
      stub(async () => json({ content: 42, slug: 'hi' }))
    )
    expect(r).toMatchObject({ kind: 'error', reason: 'malformed' })
  })

  it('a request that never answers times out as "unreachable" instead of hanging the page', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hang = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener('abort', () =>
            rej(
              init.signal?.reason instanceof Error
                ? init.signal.reason
                : new Error('aborted')
            )
          )
        })
    )
    const r = await loadPreviewDraft(API, hang, { timeoutMs: 20 })
    expect(r).toMatchObject({ kind: 'error', reason: 'unreachable' })
    expect(r.kind === 'error' && r.message).toMatch(/didn't answer/)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { apiOnError } from '../src/errors'

/** #291 (OWASP A10:2025) — the shared fail-secure onError handler every Hono factory mounts.
 *  Prod: generic envelope + correlation id, never the message/stack/paths. Dev: + `detail`.
 *  Deliberate HTTPExceptions pass through untouched. */

const SECRET_MESSAGE = '/Users/secret/path.ts blew up'

function buildApp() {
  const app = new Hono()
  app.get('/boom', () => {
    throw new Error(SECRET_MESSAGE)
  })
  app.get('/teapot', () => {
    throw new HTTPException(418, { message: 'deliberate teapot' })
  })
  app.onError(apiOnError())
  return app
}

const req = (app: Hono, path: string) =>
  app.fetch(new Request(`http://test${path}`))

describe('apiOnError', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prod: responds with a generic envelope + id and leaks NO internal detail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const res = await req(buildApp(), '/boom')
      expect(res.status).toBe(500)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.error).toBe('internal_error')
      expect(typeof body.id).toBe('string')
      expect((body.id as string).length).toBeGreaterThan(0)
      expect(body.detail).toBeUndefined()
      const raw = JSON.stringify(body)
      expect(raw).not.toContain('secret')
      expect(raw).not.toContain('blew up')
    } finally {
      process.env.NODE_ENV = prev
    }
  })

  it('dev: same envelope plus a `detail` with the message (still no stack)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await req(buildApp(), '/boom')
    expect(res.status).toBe(500)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('internal_error')
    expect(typeof body.id).toBe('string')
    expect(body.detail).toBe(SECRET_MESSAGE)
    expect(JSON.stringify(body)).not.toContain('at ') // no stack frames in the body
  })

  it('logs the full error server-side with the SAME correlation id the response carries', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await req(buildApp(), '/boom')
    const body = (await res.json()) as { id: string }
    expect(spy).toHaveBeenCalledTimes(1)
    const [line, err] = spy.mock.calls[0] as [string, Error]
    expect(line).toContain(body.id)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe(SECRET_MESSAGE)
  })

  it('lets a deliberate HTTPException produce its own response', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await req(buildApp(), '/teapot')
    expect(res.status).toBe(418)
    expect(await res.text()).toBe('deliberate teapot')
    expect(spy).not.toHaveBeenCalled() // deliberate responses are not error-logged
  })
})

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { buildCapabilities, createCapabilitiesApi } from '../src/capabilities'

describe('capabilities', () => {
  it('imageProcessing is true only when an image adapter is wired', () => {
    expect(buildCapabilities({ image: {}, writableMediaStore: true, backgroundJobs: true }).capabilities.imageProcessing).toBe(true)
    expect(buildCapabilities({ writableMediaStore: true, backgroundJobs: true }).capabilities.imageProcessing).toBe(false)
  })
  it('serves the capability object at GET /api/capabilities', async () => {
    const app = createCapabilitiesApi(buildCapabilities({ image: {}, writableMediaStore: true, backgroundJobs: true, mode: 'self-hosted' }))
    const res = await app.fetch(new Request('http://test/api/capabilities'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mode: 'self-hosted',
      capabilities: { imageProcessing: true, writableMediaStore: true, backgroundJobs: true },
    })
  })

  // Regression coverage for the CORS-clobbering bug: capabilities.ts carried its own permissive
  // `app.use('*', cors())`, which — once mounted under a central allowlisted `cors()` in
  // server.ts — silently overrode it back to `Access-Control-Allow-Origin: *` (last-write-wins in
  // Hono). These tests verify the central CORS policy is not clobbered when capabilities is
  // mounted under it.
  it('with central CORS allowlist: trusted Origin -> access-control-allow-origin echoes that origin', async () => {
    const trustedOrigin = 'http://localhost:5173'
    const app = new Hono()
    app.use(
      '*',
      cors({
        origin: (origin) => origin === trustedOrigin ? origin : undefined,
        credentials: true,
      }),
    )
    app.route('/', createCapabilitiesApi(buildCapabilities({ image: {}, writableMediaStore: true, backgroundJobs: true })))
    const res = await app.fetch(
      new Request('http://test/api/capabilities', { headers: { origin: trustedOrigin } }),
    )
    expect(res.headers.get('access-control-allow-origin')).toBe(trustedOrigin)
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('with central CORS allowlist: untrusted Origin -> access-control-allow-origin is absent', async () => {
    const trustedOrigin = 'http://localhost:5173'
    const app = new Hono()
    app.use(
      '*',
      cors({
        origin: (origin) => origin === trustedOrigin ? origin : undefined,
        credentials: true,
      }),
    )
    app.route('/', createCapabilitiesApi(buildCapabilities({ image: {}, writableMediaStore: true, backgroundJobs: true })))
    const res = await app.fetch(
      new Request('http://test/api/capabilities', { headers: { origin: 'https://evil.example' } }),
    )
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

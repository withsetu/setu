import { describe, it, expect } from 'vitest'
import { buildCapabilities, createCapabilitiesApi } from '../src/capabilities'

describe('capabilities', () => {
  it('imageProcessing is true only when an image adapter is wired', () => {
    expect(
      buildCapabilities({
        image: {},
        writableMediaStore: true,
        backgroundJobs: true
      }).capabilities.imageProcessing
    ).toBe(true)
    expect(
      buildCapabilities({ writableMediaStore: true, backgroundJobs: true })
        .capabilities.imageProcessing
    ).toBe(false)
  })
  it('serves the capability object at GET /api/capabilities', async () => {
    const app = createCapabilitiesApi(
      buildCapabilities({
        image: {},
        writableMediaStore: true,
        backgroundJobs: true,
        mode: 'self-hosted'
      })
    )
    const res = await app.fetch(new Request('http://test/api/capabilities'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mode: 'self-hosted',
      capabilities: {
        imageProcessing: true,
        writableMediaStore: true,
        backgroundJobs: true
      }
    })
  })
})

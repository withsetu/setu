import { Hono } from 'hono'
import { cors } from 'hono/cors'

export interface Capabilities {
  mode?: string
  capabilities: { imageProcessing: boolean; writableMediaStore: boolean; backgroundJobs: boolean }
}

export function buildCapabilities(opts: {
  image?: unknown
  writableMediaStore: boolean
  backgroundJobs: boolean
  mode?: string
}): Capabilities {
  return {
    ...(opts.mode ? { mode: opts.mode } : {}),
    capabilities: {
      imageProcessing: !!opts.image,
      writableMediaStore: opts.writableMediaStore,
      backgroundJobs: opts.backgroundJobs,
    },
  }
}

export function createCapabilitiesApi(caps: Capabilities) {
  const app = new Hono()
  app.use('*', cors())
  app.get('/api/capabilities', (c) => c.json(caps))
  return app
}

import { execSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  siteAppDir,
  startDevServer,
  waitForResponse,
  type DevServer
} from './lib/dev-server'

/**
 * #1123 — the dev-only /preview route, driven through a REAL `astro dev` against a stub api
 * whose answer each case switches. The classifier itself is unit-tested in
 * apps/site/test/preview-load-draft.test.ts; this suite proves the page renders each outcome:
 * the empty state ONLY for a genuine no-draft, and an error state with a Retry link for the rest.
 */
type Mode = 'draft' | 'empty' | 'server' | 'absent' | 'malformed'
let mode: Mode = 'empty'

const draft = {
  content: '---\ntitle: Stub Draft Title\n---\n\nStub draft body.\n',
  collection: 'post',
  locale: 'en',
  slug: 'stub'
}

let api: Server | undefined
let apiOrigin = ''
let server: DevServer | undefined

function startStubApi(port = 0): Promise<Server> {
  const s = createServer((req, res) => {
    if (req.url !== '/preview') {
      res.writeHead(404).end()
      return
    }
    const send = (status: number, body: string, type = 'application/json') =>
      res.writeHead(status, { 'content-type': type }).end(body)
    if (mode === 'draft') send(200, JSON.stringify(draft))
    else if (mode === 'empty')
      send(404, JSON.stringify({ error: 'no preview draft', empty: true }))
    else if (mode === 'server')
      send(500, JSON.stringify({ error: 'internal error' }))
    else if (mode === 'absent') send(404, '404 Not Found', 'text/plain')
    else send(200, '{"content":"---\\ntit')
  })
  return new Promise((resolve) => s.listen(port, '127.0.0.1', () => resolve(s)))
}

beforeAll(async () => {
  execSync(
    'node ../../scripts/gen-blocks.mjs && node ../../scripts/gen-relations.mjs',
    { cwd: siteAppDir, stdio: 'pipe' }
  )
  api = await startStubApi()
  apiOrigin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`
  server = await startDevServer({ SETU_API_URL: apiOrigin })
  await waitForResponse(`${server.origin}/preview`, (res) => res.status !== 0, {
    describe: 'the dev server to serve /preview',
    timeoutMs: 90_000,
    log: server.log
  })
}, 180_000)

afterAll(async () => {
  await server?.stop()
  await new Promise((r) => (api ? api.close(r) : r(undefined)))
})

const get = async () => {
  const res = await fetch(`${server!.origin}/preview?n=7`)
  return { status: res.status, body: await res.text() }
}
const EMPTY = 'Nothing to preview yet'
const RETRY = /<a[^>]*href="\/preview\?n=7"[^>]*>\s*Try again\s*<\/a>/

describe('astro dev /preview states (#1123)', () => {
  it('renders the pushed draft', async () => {
    mode = 'draft'
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body).toContain('Stub Draft Title')
    expect(body).toContain('Stub draft body.')
  })

  it('1 · genuine no-draft → the empty state, no error, no retry', async () => {
    mode = 'empty'
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body).toContain(EMPTY)
    expect(body).not.toContain('role="alert"')
  })

  it('3 · api 5xx → error state naming the status, with Retry', async () => {
    mode = 'server'
    const { status, body } = await get()
    expect(status).toBe(502)
    expect(body).not.toContain(EMPTY)
    expect(body).toContain('role="alert"')
    expect(body).toContain('500')
    expect(body).toMatch(RETRY)
  })

  it('4 · preview route absent (bare 404) → error state, not empty', async () => {
    mode = 'absent'
    const { status, body } = await get()
    expect(status).toBe(502)
    expect(body).not.toContain(EMPTY)
    expect(body).toContain('role="alert"')
    expect(body).toMatch(/preview is turned off/i)
    expect(body).toMatch(RETRY)
  })

  it('5 · malformed body → error state, not empty', async () => {
    mode = 'malformed'
    const { status, body } = await get()
    expect(status).toBe(502)
    expect(body).not.toContain(EMPTY)
    expect(body).toContain('role="alert"')
    expect(body).toMatch(RETRY)
  })

  it('2 · api unreachable → error state naming the url; Retry recovers once it is back', async () => {
    const port = (api!.address() as AddressInfo).port
    await new Promise((r) => api!.close(r))
    const down = await get()
    expect(down.status).toBe(502)
    expect(down.body).not.toContain(EMPTY)
    expect(down.body).toContain('role="alert"')
    expect(down.body).toContain(apiOrigin)
    expect(down.body).toMatch(RETRY)

    // Bring the api back on the SAME port: following the Retry link renders the draft.
    mode = 'draft'
    api = await startStubApi(port)
    const back = await get()
    expect(back.status).toBe(200)
    expect(back.body).toContain('Stub Draft Title')
  })
})

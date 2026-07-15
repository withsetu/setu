import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { DraftInput, TiptapDoc } from '@setu/core'
import { INDEX_VERSION } from '@setu/core'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider, useIndex } from '../src/data/index-store'

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})
const seed: DraftInput[] = [
  {
    collection: 'post',
    locale: 'en',
    slug: 'a',
    content: doc('a'),
    metadata: { title: 'Alpha' }
  }
]

function Probe() {
  const index = useIndex()
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    void (async () => {
      await index.ensureBuilt()
      setN(
        (await index.query({ collection: 'post', offset: 0, limit: 10 })).total
      )
    })()
  }, [index])
  return <div>total:{n ?? '…'}</div>
}

describe('IndexProvider', () => {
  it('provides a built index service', async () => {
    render(
      <ServicesProvider
        services={servicesFor(
          createMemoryDataPort(seed),
          createMemoryGitPort()
        )}
      >
        <DeployProvider>
          <IndexProvider>
            <Probe />
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    )
    await waitFor(() => expect(screen.getByText(/total:1/)).toBeInTheDocument())
  })

  it('uses the INJECTED (shared) index port — another tab’s row is visible without a rebuild', async () => {
    // Simulate the shared idb index: a row indexed by "another tab", and meta marked
    // built so ensureBuilt is a no-op (must not rebuild over the shared/persisted index).
    const shared = createMemoryIndexPort()
    await shared.upsert({
      key: 'post\0en\0x',
      collection: 'post',
      locale: 'en',
      slug: 'x',
      title: 'X',
      titleLower: 'x',
      status: 'draft',
      updatedAt: 1,
      hasDraft: true,
      date: null,
      tags: [],
      categories: [],
      mediaRefs: []
    })
    await shared.setMeta({ indexedSha: 'built', version: INDEX_VERSION })
    // The data port is EMPTY — if the provider rebuilt instead of using the shared
    // index, total would be 0. It must use services.index as-is → total:1.
    const services = servicesFor(
      createMemoryDataPort(),
      createMemoryGitPort(),
      shared
    )
    render(
      <ServicesProvider services={services}>
        <DeployProvider>
          <IndexProvider>
            <Probe />
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    )
    await waitFor(() => expect(screen.getByText(/total:1/)).toBeInTheDocument())
  })
})

describe('IndexProvider — server-backed (apiBase) selection (#464)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serves queries through /api/index when the services carry an apiBase', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      // Base needed: DeployProvider fetches a RELATIVE /api/deploy/status in tests.
      const url = new URL(String(input), 'http://local')
      if (url.pathname === '/api/index/query')
        return {
          ok: true,
          status: 200,
          json: async () => ({
            rows: [
              {
                ref: { collection: 'post', locale: 'en', slug: 'srv' },
                title: 'From server',
                locale: 'en',
                lifecycle: { state: 'staged' },
                updatedAt: null,
                hasDraft: false,
                date: null,
                tags: [],
                categories: [],
                mediaRefs: []
              }
            ],
            total: 1
          })
        } as unknown as Response
      return { ok: false, status: 404 } as Response
    })
    vi.stubGlobal('fetch', fetchSpy)
    // EVERY local port is empty: a locally-built index would answer total:0.
    // total:1 can only come from the stubbed server route.
    const services = servicesFor(
      createMemoryDataPort(),
      createMemoryGitPort(),
      undefined,
      undefined,
      undefined,
      'http://api'
    )
    render(
      <ServicesProvider services={services}>
        <DeployProvider>
          <IndexProvider>
            <Probe />
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    )
    await waitFor(() => expect(screen.getByText(/total:1/)).toBeInTheDocument())
    const paths = fetchSpy.mock.calls.map(
      (c) => new URL(String(c[0]), 'http://local').pathname
    )
    expect(paths).toContain('/api/index/query')
  })
})

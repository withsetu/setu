import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import type { ContentRow, TiptapDoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import {
  IndexProvider,
  useCommittedIndexQuery,
  useIndex
} from '../src/data/index-store'
import { LocaleControl } from '../src/editor/controls/locale'

// #1245: the Query / Latest Posts canvas preview reads the content index through
// useCommittedIndexQuery — server truth with no local-draft overlay when the API owns the
// index, so an unsaved working copy can't change what the published block appears to list.

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})

const serverRow = (slug: string, title: string): ContentRow => ({
  ref: { collection: 'post', locale: 'en', slug },
  title,
  locale: 'en',
  lifecycle: { state: 'staged' },
  updatedAt: null,
  hasDraft: false,
  date: null,
  tags: [],
  categories: [],
  mediaRefs: [],
  audit: { audited: true, hasTitle: true, imagesWithoutAlt: 0, h1Count: 0 },
  hasFeaturedImage: false,
  hasSeoOverrides: false
})

function Probe() {
  const committed = useCommittedIndexQuery()
  const index = useIndex()
  const [out, setOut] = useState('')
  useEffect(() => {
    const q = { collection: 'post', offset: 0, limit: 50 }
    // The browser-built index answers empty until its first build lands.
    void index
      .ensureBuilt()
      .then(() => Promise.all([committed(q), index.query(q)]))
      .then(([c, o]) =>
        setOut(
          `committed=${c.rows.map((r) => r.title).join(',')} overlaid=${o.rows
            .map((r) => r.title)
            .join(',')}`
        )
      )
  }, [committed, index])
  return <p>{out}</p>
}

const drafts = () =>
  createMemoryDataPort([
    {
      collection: 'post',
      locale: 'en',
      slug: 'a',
      content: doc('edited'),
      metadata: { title: 'Alpha (unsaved edit)' }
    }
  ])

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useCommittedIndexQuery', () => {
  it('API topology: server rows without this browser’s draft overlay', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString()
        )
        if (url.pathname === '/api/index/query')
          return new Response(
            JSON.stringify({ rows: [serverRow('a', 'Alpha')], total: 1 }),
            { status: 200 }
          )
        return new Response('{}', { status: 404 })
      })
    )
    const services = servicesFor(
      drafts(),
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
    expect(
      await screen.findByText('committed=Alpha overlaid=Alpha (unsaved edit)')
    ).toBeInTheDocument()
  })

  it('browser-built index (no API): answers with the index’s own query', async () => {
    render(
      <ServicesProvider services={servicesFor(drafts(), createMemoryGitPort())}>
        <DeployProvider>
          <IndexProvider>
            <Probe />
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    )
    await waitFor(() =>
      expect(
        screen.getByText(
          'committed=Alpha (unsaved edit) overlaid=Alpha (unsaved edit)'
        )
      ).toBeInTheDocument()
    )
  })
})

describe('LocaleControl — unset option names what the site renders (#1245)', () => {
  it('labels the unset value as the site default locale, not “any locale”', async () => {
    render(
      <ServicesProvider
        services={servicesFor(createMemoryDataPort([]), createMemoryGitPort())}
      >
        <DeployProvider>
          <IndexProvider>
            <LocaleControl
              value={undefined}
              onChange={() => {}}
              meta={{ name: 'locale', apiBase: '', onPickMedia: () => {} }}
            />
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    )
    expect(await screen.findByText('Site default (en)')).toBeInTheDocument()
    expect(screen.queryByText(/any locale/i)).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { DraftInput, TiptapDoc } from '@setu/core'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider, useIndex } from '../src/data/index-store'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const seed: DraftInput[] = [{ collection: 'post', locale: 'en', slug: 'a', content: doc('a'), metadata: { title: 'Alpha' } }]

function Probe() {
  const index = useIndex()
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    void (async () => {
      await index.ensureBuilt()
      setN((await index.query({ collection: 'post', offset: 0, limit: 10 })).total)
    })()
  }, [index])
  return <div>total:{n ?? '…'}</div>
}

describe('IndexProvider', () => {
  it('provides a built index service', async () => {
    render(
      <ServicesProvider services={servicesFor(createMemoryDataPort(seed), createMemoryGitPort())}>
        <DeployProvider>
          <IndexProvider>
            <Probe />
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>,
    )
    await waitFor(() => expect(screen.getByText(/total:1/)).toBeInTheDocument())
  })
})

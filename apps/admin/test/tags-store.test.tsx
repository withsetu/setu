import { describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createIndexService } from '@setu/core'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TagsProvider, useTags } from '../src/data/tags-store'
import type { ReactNode } from 'react'

const AUTHOR = { name: 'T', email: 't@x.dev' }
const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

/** Minimal full provider tree for tags-store tests. */
function makeWrapper(
  data = createMemoryDataPort(),
  git = createMemoryGitPort(),
  indexPort = createMemoryIndexPort(),
) {
  const services = servicesFor(data, git, indexPort)
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServicesProvider services={services}>
        <DeployProvider>
          <IndexProvider>
            <TagsProvider>{children}</TagsProvider>
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    )
  }
  return { services, Wrapper, data, git, indexPort }
}

describe('TagsProvider — rename (pure)', () => {
  it('renames a tag across all entries and refreshes counts', async () => {
    const data = createMemoryDataPort([
      { collection: 'post', locale: 'en', slug: 'a', content: doc('a') as any, metadata: { title: 'A', tags: ['react'] } },
      { collection: 'post', locale: 'en', slug: 'b', content: doc('b') as any, metadata: { title: 'B', tags: ['react'] } },
    ])
    const git = createMemoryGitPort()
    const indexPort = createMemoryIndexPort()

    // Build live index
    const idx = createIndexService({ data, git, index: indexPort, deployedAt: () => null })
    await idx.rebuild()

    const { Wrapper } = makeWrapper(data, git, indexPort)
    const { result } = renderHook(() => useTags(), { wrapper: Wrapper })

    // Wait for counts to load
    await act(async () => {})
    // Spin until index is populated
    await act(async () => { /* give refreshCounts a tick */ })

    // Act: rename react → reactjs
    let res: { applied: number; merged: boolean } | undefined
    await act(async () => {
      res = await result.current.rename('react', 'reactjs')
    })

    expect(res?.applied).toBe(2)
    expect(res?.merged).toBe(false)
    expect(result.current.counts['react']).toBeUndefined()
    expect(result.current.counts['reactjs']).toBe(2)
  })
})

describe('TagsProvider — rename (merge)', () => {
  it('merges when rename target already exists, deduping the source entry', async () => {
    // post A: ['react', 'reactjs'], post B: ['react']
    // rename('react', 'reactjs') → A stays ['reactjs'] (deduped), B becomes ['reactjs']
    const data = createMemoryDataPort([
      { collection: 'post', locale: 'en', slug: 'a', content: doc('a') as any, metadata: { title: 'A', tags: ['react', 'reactjs'] } },
      { collection: 'post', locale: 'en', slug: 'b', content: doc('b') as any, metadata: { title: 'B', tags: ['react'] } },
    ])
    const git = createMemoryGitPort()
    const indexPort = createMemoryIndexPort()

    const idx = createIndexService({ data, git, index: indexPort, deployedAt: () => null })
    await idx.rebuild()

    const { Wrapper } = makeWrapper(data, git, indexPort)
    const { result } = renderHook(() => useTags(), { wrapper: Wrapper })

    await act(async () => {})
    await act(async () => {})

    let res: { applied: number; merged: boolean } | undefined
    await act(async () => {
      res = await result.current.rename('react', 'reactjs')
    })

    expect(res?.merged).toBe(true)
    // Only B actually changes (A already had 'reactjs', bulkAddTag dedupes; both are in entriesByTag('react'))
    // counts['react'] must be gone
    expect(result.current.counts['react']).toBeUndefined()
    // reactjs must still exist with ≥ 1
    expect((result.current.counts['reactjs'] ?? 0) >= 1).toBe(true)
  })
})

describe('TagsProvider — remove (delete)', () => {
  it('removes a tag from all entries and refreshes counts', async () => {
    const data = createMemoryDataPort([
      { collection: 'post', locale: 'en', slug: 'a', content: doc('a') as any, metadata: { title: 'A', tags: ['css'] } },
      { collection: 'post', locale: 'en', slug: 'b', content: doc('b') as any, metadata: { title: 'B', tags: ['css'] } },
    ])
    const git = createMemoryGitPort()
    const indexPort = createMemoryIndexPort()

    const idx = createIndexService({ data, git, index: indexPort, deployedAt: () => null })
    await idx.rebuild()

    const { Wrapper } = makeWrapper(data, git, indexPort)
    const { result } = renderHook(() => useTags(), { wrapper: Wrapper })

    await act(async () => {})
    await act(async () => {})

    let res: { applied: number } | undefined
    await act(async () => {
      res = await result.current.remove('css')
    })

    expect(res?.applied).toBe(2)
    expect(result.current.counts['css']).toBeUndefined()
  })
})

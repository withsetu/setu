import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createIndexService, serializeCategories } from '@setu/core'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider, useTaxonomy } from '../src/data/taxonomy-store'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

const AUTHOR = { name: 'T', email: 't@x.dev' }
const doc = (t: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})

/** Minimal full provider tree for taxonomy-store tests. */
function makeWrapper(
  data = createMemoryDataPort(),
  git = createMemoryGitPort(),
  index = createMemoryIndexPort()
) {
  const services = servicesFor(data, git, index)
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServicesProvider services={services}>
        <DeployProvider>
          <IndexProvider>
            <TaxonomyProvider>{children}</TaxonomyProvider>
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    )
  }
  return { services, Wrapper, data, git, index }
}

function Probe() {
  const { categories, create } = useTaxonomy()
  return (
    <div>
      <button onClick={() => void create({ name: 'Tutorials', parent: null })}>
        add
      </button>
      <ul>
        {categories.map((c) => (
          <li key={c.slug}>{c.slug}</li>
        ))}
      </ul>
    </div>
  )
}

describe('TaxonomyProvider', () => {
  it('starts empty and adds a category on create', async () => {
    const { Wrapper } = makeWrapper()
    render(<Probe />, { wrapper: Wrapper })
    expect(screen.queryByText('tutorials')).toBeNull()
    screen.getByText('add').click()
    await waitFor(() => expect(screen.getByText('tutorials')).toBeTruthy())
  })

  it('remove() strips the category from categories and refreshes counts', async () => {
    const indexPort = createMemoryIndexPort()
    const data = createMemoryDataPort([
      {
        collection: 'post',
        locale: 'en',
        slug: 'a',
        content: doc('a') as any,
        metadata: { title: 'A', categories: ['eng'] }
      }
    ])
    const git = createMemoryGitPort()

    // Seed categories.yaml so the deleter can find 'eng'
    const catsYaml = serializeCategories([
      { slug: 'eng', name: 'Engineering', parent: null }
    ])
    await git.commitFile({
      path: 'taxonomy/categories.yaml',
      content: catsYaml,
      message: 'seed cats',
      author: AUTHOR
    })

    // Build the index with real IndexService so entriesByCategory + categoryCounts work
    const idx = createIndexService({
      data,
      git,
      index: indexPort,
      deployedAt: () => null
    })
    await idx.rebuild()

    const services = servicesFor(data, git, indexPort)

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <ServicesProvider services={services}>
          <DeployProvider>
            <IndexProvider>
              <TaxonomyProvider>{children}</TaxonomyProvider>
            </IndexProvider>
          </DeployProvider>
        </ServicesProvider>
      )
    }

    const { result } = renderHook(() => useTaxonomy(), { wrapper: Wrapper })

    // Wait for the provider to load categories from git
    await waitFor(() =>
      expect(result.current.categories.some((c) => c.slug === 'eng')).toBe(true)
    )

    // Wait for counts to be populated ('eng' is used by 1 entry)
    await waitFor(() => expect(result.current.counts['eng']).toBe(1))

    // Act: remove 'eng'
    await act(async () => {
      await result.current.remove('eng')
    })

    // categories must not include 'eng'
    expect(
      result.current.categories.find((c) => c.slug === 'eng')
    ).toBeUndefined()

    // counts must not include 'eng'
    expect(result.current.counts['eng']).toBeUndefined()
  })

  it('remove() promotes child categories to top level when parent is deleted', async () => {
    const indexPort = createMemoryIndexPort()
    const data = createMemoryDataPort([])
    const git = createMemoryGitPort()

    // Seed categories.yaml with a parent 'eng' and child 'frontend' (parent: 'eng')
    const catsYaml = serializeCategories([
      { slug: 'eng', name: 'Engineering', parent: null },
      { slug: 'frontend', name: 'Frontend', parent: 'eng' }
    ])
    await git.commitFile({
      path: 'taxonomy/categories.yaml',
      content: catsYaml,
      message: 'seed cats',
      author: AUTHOR
    })

    // Build the index so the provider loads correctly
    const idx = createIndexService({
      data,
      git,
      index: indexPort,
      deployedAt: () => null
    })
    await idx.rebuild()

    const services = servicesFor(data, git, indexPort)

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <ServicesProvider services={services}>
          <DeployProvider>
            <IndexProvider>
              <TaxonomyProvider>{children}</TaxonomyProvider>
            </IndexProvider>
          </DeployProvider>
        </ServicesProvider>
      )
    }

    const { result } = renderHook(() => useTaxonomy(), { wrapper: Wrapper })

    // Wait for both categories to load
    await waitFor(() => {
      expect(result.current.categories.some((c) => c.slug === 'eng')).toBe(true)
      expect(result.current.categories.some((c) => c.slug === 'frontend')).toBe(
        true
      )
    })

    // Confirm 'frontend' starts with parent 'eng'
    expect(
      result.current.categories.find((c) => c.slug === 'frontend')?.parent
    ).toBe('eng')

    // Act: delete the parent 'eng'
    await act(async () => {
      await result.current.remove('eng')
    })

    // 'eng' must be gone
    expect(
      result.current.categories.find((c) => c.slug === 'eng')
    ).toBeUndefined()

    // 'frontend' must be promoted to top level (parent === null)
    expect(
      result.current.categories.find((c) => c.slug === 'frontend')?.parent
    ).toBeNull()
  })
})

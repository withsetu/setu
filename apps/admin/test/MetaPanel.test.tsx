import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { MetaPanel } from '../src/editor/MetaPanel'

function setup(props?: Partial<React.ComponentProps<typeof MetaPanel>>) {
  const onChange = vi.fn()
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort())
  const defaults = {
    metadata: { title: 'Hello', categories: [], tags: [] },
    locale: 'en',
    slug: 'my-post',
    editable: true,
    onChange,
    apiBase: 'http://localhost:4444',
  }
  render(
    <ServicesProvider services={services}>
      <DeployProvider>
        <IndexProvider>
          <TaxonomyProvider>
            <MetaPanel {...defaults} {...props} />
          </TaxonomyProvider>
        </IndexProvider>
      </DeployProvider>
    </ServicesProvider>,
  )
  return { onChange }
}

describe('MetaPanel', () => {
  it('renders a Featured image section between Permalink and Categories', () => {
    setup()
    const texts = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    const permalinkIdx = texts.indexOf('Permalink')
    const featuredIdx = texts.indexOf('Featured image')
    const categoriesIdx = texts.indexOf('Categories')
    expect(featuredIdx).not.toBe(-1)
    expect(permalinkIdx).toBeLessThan(featuredIdx)
    expect(featuredIdx).toBeLessThan(categoriesIdx)
  })

  it('renders section headings in DOM order: Permalink, Categories, Tags', () => {
    setup()
    const headings = screen.getAllByRole('heading', { level: 2 })
    const texts = headings.map((h) => h.textContent)
    const permalinkIdx = texts.indexOf('Permalink')
    const categoriesIdx = texts.indexOf('Categories')
    const tagsIdx = texts.indexOf('Tags')
    expect(permalinkIdx).not.toBe(-1)
    expect(categoriesIdx).not.toBe(-1)
    expect(tagsIdx).not.toBe(-1)
    expect(permalinkIdx).toBeLessThan(categoriesIdx)
    expect(categoriesIdx).toBeLessThan(tagsIdx)
  })

  it('does NOT render a Status control', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'Draft' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Staged' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Deployed' })).toBeNull()
    expect(screen.queryByText('Status')).toBeNull()
  })

  it('onChange is never called with a status key on mount', () => {
    const { onChange } = setup()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Permalink section shows /{slug} and {locale}', () => {
    setup({ slug: 'my-post', locale: 'en' })
    expect(screen.getByText('/my-post')).toBeInTheDocument()
    expect(screen.getByText('en')).toBeInTheDocument()
  })
})

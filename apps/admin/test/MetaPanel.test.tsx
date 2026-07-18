import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
  const defaults: React.ComponentProps<typeof MetaPanel> = {
    metadata: { title: 'Hello', categories: [], tags: [] },
    collection: 'post',
    locale: 'en',
    slug: 'my-post',
    editable: true,
    committed: false,
    permalinkConfig: {
      pattern: ':collection/:slug',
      uncategorized: 'uncategorized'
    },
    date: Date.UTC(2026, 6, 4),
    categories: [],
    onRename: vi.fn(async () => ({ renamed: true, committedSha: null })),
    onChange,
    apiBase: 'http://localhost:4444'
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
    </ServicesProvider>
  )
  return { onChange }
}

describe('MetaPanel', () => {
  it('renders a Featured image section between Permalink and Categories', () => {
    setup()
    const texts = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent)
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

  it('Permalink section renders an editable slug input plus the locale', () => {
    setup({ slug: 'my-post', locale: 'en' })
    expect(screen.getByRole('textbox', { name: 'Slug' })).toHaveValue('my-post')
    expect(screen.getByText('en')).toBeInTheDocument()
  })

  it('Permalink section shows the resolved full-URL preview', () => {
    setup({ slug: 'my-post' })
    expect(screen.getByText('localhost:4321/post/my-post')).toBeInTheDocument()
  })

  // #580 — WordPress parity: categories/tags are post taxonomies; pages have none.
  describe('taxonomy fields are post-only', () => {
    const sectionTitles = () =>
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)

    it('post: renders both Categories and Tags sections', () => {
      setup({ collection: 'post' })
      expect(sectionTitles()).toContain('Categories')
      expect(sectionTitles()).toContain('Tags')
    })

    it('page: renders neither Categories nor Tags, other sections intact', () => {
      setup({ collection: 'page', slug: 'about' })
      const titles = sectionTitles()
      expect(titles).not.toContain('Categories')
      expect(titles).not.toContain('Tags')
      // The rest of the panel is unaffected.
      for (const t of ['Permalink', 'Published', 'Featured image', 'SEO']) {
        expect(titles).toContain(t)
      }
    })

    it('page: hand-authored tags/categories frontmatter survives other edits', () => {
      // Data honesty: the fields are not OFFERED for pages, but frontmatter the
      // author typed by hand must round-trip untouched through unrelated edits.
      const { onChange } = setup({
        collection: 'page',
        slug: 'about',
        metadata: {
          title: 'About',
          tags: ['legacy-tag'],
          categories: ['legacy-cat']
        }
      })
      fireEvent.change(screen.getByRole('textbox', { name: 'SEO title' }), {
        target: { value: 'Custom SEO title' }
      })
      expect(onChange).toHaveBeenCalled()
      const next = onChange.mock.calls.at(-1)![0] as Record<string, unknown>
      expect(next['tags']).toEqual(['legacy-tag'])
      expect(next['categories']).toEqual(['legacy-cat'])
    })
  })

  it('shows the no-date fallback hint when the pattern has date tokens but no date', () => {
    setup({
      permalinkConfig: {
        pattern: ':year/:month/:day/:slug',
        uncategorized: 'uncategorized'
      },
      date: null
    })
    expect(
      screen.getByText('No publish date — using /my-post')
    ).toBeInTheDocument()
  })
})

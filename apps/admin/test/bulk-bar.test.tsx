import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ContentRow } from '@setu/core'
import { contentPath, serializeMdoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { NotificationProvider } from '../src/ui/notify'
import { BulkBar } from '../src/screens/BulkBar'

const TAXONOMY_YAML = `- slug: news\n  name: News\n  parent: null\n`

const row = (slug: string, over: Partial<ContentRow> = {}): ContentRow => ({
  ref: { collection: 'post', locale: 'en', slug },
  title: slug,
  locale: 'en',
  lifecycle: { state: 'live' },
  updatedAt: 1,
  hasDraft: false,
  tags: [],
  categories: [],
  mediaRefs: [],
  ...over
})

function setup(rows: ContentRow[], { withTaxonomy = false } = {}) {
  const seed = rows.map((r) => ({
    path: contentPath(r.ref),
    content: serializeMdoc({ frontmatter: { title: r.title }, body: 'x' })
  }))
  if (withTaxonomy)
    seed.push({ path: 'taxonomy/categories.yaml', content: TAXONOMY_YAML })
  // seed committed files so loadForEdit can fork them
  const git = createMemoryGitPort(seed)
  const data = createMemoryDataPort()
  const services = servicesFor(data, git)
  const onDone = vi.fn()
  const onClear = vi.fn()
  const selected = new Set(
    rows.map((r) => `${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`)
  )
  render(
    <ServicesProvider services={services}>
      <DeployProvider>
        <IndexProvider>
          <TaxonomyProvider>
            <NotificationProvider>
              <BulkBar
                rows={rows}
                selected={selected}
                onClear={onClear}
                onDone={onDone}
              />
            </NotificationProvider>
          </TaxonomyProvider>
        </IndexProvider>
      </DeployProvider>
    </ServicesProvider>
  )
  return { git, data, onDone, onClear }
}

describe('BulkBar', () => {
  it('adds a tag to all selected entries (Enter) and notifies', async () => {
    const { git } = setup([row('a'), row('b')])
    const input = screen.getByLabelText('Bulk tag')
    fireEvent.change(input, { target: { value: 'news' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText(/Added .*news.* to 2/i)).toBeTruthy()
    const { parseMdoc } = await import('@setu/core')
    const a = parseMdoc(
      (await git.readFile(
        contentPath({ collection: 'post', locale: 'en', slug: 'a' })
      ))!
    )
    expect(a.frontmatter.tags).toEqual(['news'])
  })

  it('deletes selected entries after confirm and notifies', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { git } = setup([row('a')])
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(await screen.findByText(/Deleted 1/i)).toBeTruthy()
    expect(
      await git.readFile(
        contentPath({ collection: 'post', locale: 'en', slug: 'a' })
      )
    ).toBeNull()
  })

  it('shows the unpublished-changes heads-up count', () => {
    setup([
      row('a', { hasDraft: true, lifecycle: { state: 'staged' } }),
      row('b')
    ])
    expect(screen.getByText(/1 of 2 have unpublished changes/i)).toBeTruthy()
  })

  it('picks a category via combobox, applies Add, and updates frontmatter', async () => {
    const { git } = setup([row('a'), row('b')], { withTaxonomy: true })
    const input = screen.getByLabelText('Bulk category')

    // Type to open dropdown
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'New' } })

    // Pick the "News" option by mouseDown (fires before blur)
    const option = await screen.findByRole('option', { name: /News/i })
    fireEvent.mouseDown(option)

    // The input should now show the category name and Add should be enabled
    const addBtn = screen.getByRole('button', { name: /^Add$/i })
    expect(addBtn).not.toBeDisabled()

    fireEvent.click(addBtn)

    expect(await screen.findByText(/Added category to 2/i)).toBeTruthy()

    const { parseMdoc } = await import('@setu/core')
    const a = parseMdoc(
      (await git.readFile(
        contentPath({ collection: 'post', locale: 'en', slug: 'a' })
      ))!
    )
    expect(a.frontmatter.categories).toEqual(['news'])
  })
})

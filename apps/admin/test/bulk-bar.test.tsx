import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ContentRow } from '@setu/core'
import { contentPath, serializeMdoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider, useTaxonomy } from '../src/data/taxonomy-store'
import { TagsProvider, useTags } from '../src/data/tags-store'
import { NotificationProvider } from '../src/ui/notify'
import { BulkBar } from '../src/screens/BulkBar'

/** Renders the tag + category counts the app-level stores currently hold, so a
 *  test can assert BulkBar refreshed them (#854) without a reload. */
function CountsProbe() {
  const { counts: tagCounts } = useTags()
  const { counts: catCounts } = useTaxonomy()
  return (
    <div>
      <div data-testid="tag-counts">{JSON.stringify(tagCounts)}</div>
      <div data-testid="cat-counts">{JSON.stringify(catCounts)}</div>
    </div>
  )
}

const TAXONOMY_YAML = `- slug: news\n  name: News\n  parent: null\n`

const row = (slug: string, over: Partial<ContentRow> = {}): ContentRow => ({
  ref: { collection: 'post', locale: 'en', slug },
  title: slug,
  locale: 'en',
  lifecycle: { state: 'live' },
  updatedAt: 1,
  hasDraft: false,
  date: null,
  tags: [],
  categories: [],
  mediaRefs: [],
  audit: { audited: false, hasTitle: true, imagesWithoutAlt: 0, h1Count: 0 },
  hasFeaturedImage: false,
  hasSeoOverrides: false,
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
            <TagsProvider>
              <NotificationProvider>
                <BulkBar
                  rows={rows}
                  selected={selected}
                  onClear={onClear}
                  onDone={onDone}
                />
                <CountsProbe />
              </NotificationProvider>
            </TagsProvider>
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

  // #856: the destructive confirm is the styled shadcn AlertDialog now, not the
  // native window.confirm — clicking Delete opens the dialog, and its action
  // (not a browser prompt) performs the delete.
  it('deletes selected entries via the AlertDialog confirm and notifies', async () => {
    const { git } = setup([row('a')])
    const path = contentPath({ collection: 'post', locale: 'en', slug: 'a' })
    // The toolbar Delete button only OPENS the dialog — nothing is deleted yet.
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    const dialog = await screen.findByRole('alertdialog')
    expect(await git.readFile(path)).not.toBeNull()
    // Confirm inside the dialog (the action button, not the toolbar trigger).
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))
    expect(await screen.findByText(/Deleted 1/i)).toBeTruthy()
    expect(await git.readFile(path)).toBeNull()
  })

  it('does not use the native window.confirm for bulk delete (#856)', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    setup([row('a')])
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
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

  // #854: a bulk tag-add must refresh the app-level tags store so a brand-new
  // tag appears in TagsTab (and existing counts stay fresh) without a reload.
  it('refreshes the tags store counts after a bulk tag-add (#854)', async () => {
    setup([row('a'), row('b')])
    await waitFor(() =>
      expect(screen.getByTestId('tag-counts').textContent).toBe('{}')
    )
    const input = screen.getByLabelText('Bulk tag')
    fireEvent.change(input, { target: { value: 'fresh' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText(/Added .*fresh.* to 2/i)
    // Without the refresh the store would still read {} until a reload.
    await waitFor(() => {
      const counts = JSON.parse(
        screen.getByTestId('tag-counts').textContent ?? '{}'
      ) as Record<string, number>
      expect(counts.fresh).toBe(2)
    })
  })
})

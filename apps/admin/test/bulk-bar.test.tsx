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

const row = (slug: string, over: Partial<ContentRow> = {}): ContentRow => ({
  ref: { collection: 'post', locale: 'en', slug },
  title: slug, locale: 'en', lifecycle: { state: 'live' }, updatedAt: 1, hasDraft: false, tags: [], categories: [],
  ...over,
})

function setup(rows: ContentRow[]) {
  // seed committed files so loadForEdit can fork them
  const git = createMemoryGitPort(rows.map((r) => ({ path: contentPath(r.ref), content: serializeMdoc({ frontmatter: { title: r.title }, body: 'x' }) })))
  const data = createMemoryDataPort()
  const services = servicesFor(data, git)
  const onDone = vi.fn()
  const onClear = vi.fn()
  const selected = new Set(rows.map((r) => `${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`))
  render(
    <ServicesProvider services={services}>
      <DeployProvider><IndexProvider><TaxonomyProvider>
        <NotificationProvider>
          <BulkBar rows={rows} selected={selected} onClear={onClear} onDone={onDone} />
        </NotificationProvider>
      </TaxonomyProvider></IndexProvider></DeployProvider>
    </ServicesProvider>,
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
    const a = parseMdoc((await git.readFile(contentPath({ collection: 'post', locale: 'en', slug: 'a' })))!)
    expect(a.frontmatter.tags).toEqual(['news'])
  })

  it('deletes selected entries after confirm and notifies', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { git } = setup([row('a')])
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(await screen.findByText(/Deleted 1/i)).toBeTruthy()
    expect(await git.readFile(contentPath({ collection: 'post', locale: 'en', slug: 'a' }))).toBeNull()
  })

  it('shows the unpublished-changes heads-up count', () => {
    setup([row('a', { hasDraft: true, lifecycle: { state: 'staged' } }), row('b')])
    expect(screen.getByText(/1 of 2 have unpublished changes/i)).toBeTruthy()
  })
})

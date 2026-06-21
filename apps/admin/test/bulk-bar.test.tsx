import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ContentRow } from '@setu/core'
import { contentPath, serializeMdoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { BulkBar } from '../src/screens/BulkBar'

const row = (slug: string, over: Partial<ContentRow> = {}): ContentRow => ({
  ref: { collection: 'post', locale: 'en', slug },
  title: slug, locale: 'en', lifecycle: { state: 'live' }, updatedAt: 1, hasDraft: false, tags: [], categories: [], mediaRefs: [],
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
        <BulkBar rows={rows} selected={selected} onClear={onClear} onDone={onDone} />
      </TaxonomyProvider></IndexProvider></DeployProvider>
    </ServicesProvider>,
  )
  return { git, data, onDone, onClear }
}

describe('BulkBar', () => {
  it('adds a tag to all selected entries and calls onDone', async () => {
    const { git, onDone } = setup([row('a'), row('b')])
    fireEvent.change(screen.getByLabelText('Bulk tag'), { target: { value: 'news' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const { parseMdoc } = await import('@setu/core')
    const a = parseMdoc((await git.readFile(contentPath({ collection: 'post', locale: 'en', slug: 'a' })))!)
    expect(a.frontmatter.tags).toEqual(['news'])
  })

  it('shows the unpublished-changes heads-up count', () => {
    setup([row('a', { hasDraft: true, lifecycle: { state: 'staged' } }), row('b')])
    expect(screen.getByText(/1 of 2 have unpublished changes/i)).toBeTruthy()
  })

  it('deletes selected entries after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { git, onDone } = setup([row('a')])
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(await git.readFile(contentPath({ collection: 'post', locale: 'en', slug: 'a' }))).toBeNull()
  })
})

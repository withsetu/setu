import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import type { TiptapDoc, IndexService } from '@setu/core'
import { createIndexService } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TagAutocomplete } from '../src/ui/TagAutocomplete'

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})

function setup(
  onSubmit = vi.fn(),
  exclude: string[] = [],
  opts: { failSuggestions?: boolean } = {}
) {
  const data = createMemoryDataPort([
    {
      collection: 'post',
      locale: 'en',
      slug: 's',
      content: doc('x'),
      metadata: { title: 'S', tags: ['react', 'redux'] }
    }
  ])
  const services = servicesFor(data, createMemoryGitPort())
  // The deeper failure the issue describes: createHttpIndexService already falls back
  // to its offline cache when the network drops, so TagAutocomplete's `catch` only
  // fires when the cache is unavailable or the index is unbuilt.
  const failing: IndexService = {
    ...createIndexService({
      data,
      git: services.git,
      index: services.index,
      deploy: () => ({ deployedSha: null, changed: [] })
    }),
    distinctTags: () => Promise.reject(new Error('index down'))
  }
  function Wrap() {
    const [v, setV] = useState('')
    return (
      <TagAutocomplete
        value={v}
        onChange={setV}
        onSubmit={onSubmit}
        exclude={exclude}
        ariaLabel="Add a tag"
      />
    )
  }
  render(
    <ServicesProvider services={services}>
      <DeployProvider>
        <IndexProvider {...(opts.failSuggestions ? { service: failing } : {})}>
          <Wrap />
        </IndexProvider>
      </DeployProvider>
    </ServicesProvider>
  )
  return { onSubmit }
}

describe('TagAutocomplete', () => {
  it('suggests existing tags and submits the normalized value on Enter', async () => {
    const { onSubmit } = setup()
    const input = screen.getByLabelText('Add a tag')
    fireEvent.change(input, { target: { value: 're' } })
    await screen.findByText('redux')
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // react
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('react')
  })

  it('Enter on free text submits a normalized new tag', () => {
    const { onSubmit } = setup()
    const input = screen.getByLabelText('Add a tag')
    fireEvent.change(input, { target: { value: 'Brand New' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('brand-new')
  })

  // #905 / §4 row 22: a rejected lookup used to `setMatches([])`, so "the index is
  // down" rendered exactly like "no tag starts with that" — precisely when the picker
  // is least trustworthy and the user is most likely to hand-type a duplicate tag.
  it('shows a distinguishable inline notice when the suggestion lookup fails', async () => {
    setup(vi.fn(), [], { failSuggestions: true })
    fireEvent.change(screen.getByLabelText('Add a tag'), {
      target: { value: 're' }
    })
    expect(
      await screen.findByText(/couldn’t load tag suggestions/i)
    ).not.toBeNull()
  })

  // #914: the notice named the failure but not the recovery. The effect re-runs on
  // every keystroke, so typing IS the retry — but only the implementer knew that, which
  // left the user with a red line and no next step (CLAUDE.md §3.2: an error state the
  // user is waiting on has to offer the retry).
  it('tells the user that typing again retries the lookup', async () => {
    setup(vi.fn(), [], { failSuggestions: true })
    fireEvent.change(screen.getByLabelText('Add a tag'), {
      target: { value: 're' }
    })
    const notice = await screen.findByText(/couldn’t load tag suggestions/i)
    expect(notice.textContent).toMatch(/keep typing|type again/i)
  })

  it('keeps free-text entry working when suggestions fail', async () => {
    const { onSubmit } = setup(vi.fn(), [], { failSuggestions: true })
    const input = screen.getByLabelText('Add a tag')
    fireEvent.change(input, { target: { value: 'Brand New' } })
    await screen.findByText(/couldn’t load tag suggestions/i)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('brand-new')
  })

  it('shows no failure notice when the lookup simply has no matches', async () => {
    setup()
    fireEvent.change(screen.getByLabelText('Add a tag'), {
      target: { value: 'zzz-nothing-matches' }
    })
    await new Promise((r) => setTimeout(r, 250))
    expect(screen.queryByText(/couldn’t load tag suggestions/i)).toBeNull()
  })

  it('clears the failure notice once a later lookup succeeds', async () => {
    setup()
    const input = screen.getByLabelText('Add a tag')
    fireEvent.change(input, { target: { value: 're' } })
    await screen.findByText('redux')
    expect(screen.queryByText(/couldn’t load tag suggestions/i)).toBeNull()
  })

  it('excludes already-selected tags from suggestions', async () => {
    setup(vi.fn(), ['react'])
    fireEvent.change(screen.getByLabelText('Add a tag'), {
      target: { value: 're' }
    })
    await screen.findByText('redux')
    expect(screen.queryByText('react')).toBeNull()
  })
})

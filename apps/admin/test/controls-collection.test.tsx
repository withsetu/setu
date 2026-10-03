import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  CollectionsContext,
  type CollectionsContextValue
} from '../src/data/collections-store'
import { BUILT_IN_COLLECTIONS } from '../src/data/collections'
import { controlRegistry } from '../src/editor/controls/registry'
import { resolveControls } from '@setu/core'
import { registry } from '../src/blocks/registry'

// #1126: the query block's collection picker is fed by the site's declared collections
// (/api/collections via useCollections), shows labels, stores the slug.

const PRODUCT = {
  name: 'product',
  label: 'Product',
  labelPlural: 'Products',
  taxonomies: []
}

function withCollections(
  ui: ReactNode,
  over: Partial<CollectionsContextValue> = {}
) {
  const value: CollectionsContextValue = {
    collections: [...BUILT_IN_COLLECTIONS, PRODUCT],
    loading: false,
    failed: false,
    reload: vi.fn(() => Promise.resolve()),
    ...over
  }
  return render(
    <CollectionsContext.Provider value={value}>
      {ui}
    </CollectionsContext.Provider>
  )
}

const meta = { name: 'collection', apiBase: '', onPickMedia: vi.fn() }

describe('CollectionControl', () => {
  it('is registered for the collection control type', () => {
    expect(controlRegistry.collection).toBeTypeOf('function')
  })

  it('shows the selected collection by its label, not its slug', () => {
    const C = controlRegistry.collection
    withCollections(<C value="product" onChange={vi.fn()} meta={meta} />)
    expect(
      screen.getByRole('combobox', { name: 'collection' })
    ).toHaveTextContent('Products')
  })

  it('flags a stored collection the site does not declare, instead of showing a blank', () => {
    const C = controlRegistry.collection
    withCollections(<C value="widget" onChange={vi.fn()} meta={meta} />)
    expect(
      screen.getByRole('combobox', { name: 'collection' })
    ).toHaveTextContent('widget')
    expect(
      screen.getByText(/isn.t declared in setu\.config/i)
    ).toBeInTheDocument()
  })

  it('does not flag an undeclared value while the collection list is still loading', () => {
    const C = controlRegistry.collection
    withCollections(<C value="widget" onChange={vi.fn()} meta={meta} />, {
      loading: true,
      collections: BUILT_IN_COLLECTIONS
    })
    expect(screen.queryByText(/isn.t declared/i)).not.toBeInTheDocument()
  })

  it('says when the list is only the built-in fallback, and offers a retry', () => {
    const reload = vi.fn(() => Promise.resolve())
    const C = controlRegistry.collection
    withCollections(<C value="post" onChange={vi.fn()} meta={meta} />, {
      failed: true,
      collections: BUILT_IN_COLLECTIONS,
      reload
    })
    expect(
      screen.getByText(/couldn.t load the site.s collections/i)
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(reload).toHaveBeenCalled()
  })
})

describe('query block contract → inspector', () => {
  it('resolves the collection prop to the collection dropdown (not a two-value segmented control)', () => {
    const query = registry.blocks.find((b) => b.tag === 'query')!
    const c = resolveControls(query.props, query.editor?.controls).find(
      (x) => x.name === 'collection'
    )!
    expect(c.control).toBe('collection')
    expect(c.options).toBeUndefined()
    expect(c.default).toBe('post')
  })
})

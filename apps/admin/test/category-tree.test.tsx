import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { CategoryNode } from '@setu/core'
import { CategoryTree } from '../src/screens/taxonomies/CategoryTree'

const node = (over: Partial<CategoryNode> = {}): CategoryNode => ({
  slug: 'news',
  name: 'News',
  parent: null,
  children: [],
  depth: 0,
  ...over
})

const noop = () => {}

describe('CategoryTree slug cell (#554)', () => {
  // Category slugs derive from free-text names — a very long slug must truncate inside its
  // column (full slug on hover) instead of stretching the table past the viewport.
  it('truncates a long slug with the full slug on hover', () => {
    const longSlug = 'adelaide-'.repeat(20).concat('adelaide')
    render(
      <CategoryTree
        rows={[node({ slug: longSlug, name: 'Adelaide' })]}
        counts={{}}
        onRename={noop}
        onReparent={noop}
        onDelete={noop}
      />
    )
    const el = screen.getByTitle(`/${longSlug}`)
    expect(el).toHaveTextContent(`/${longSlug}`)
    expect(el.className).toContain('truncate')
  })
})

import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { slashBlocks } from '../src/editor/blocks'
import {
  LatestPostsBlock,
  latestPostsQueryAttrs
} from '../src/editor/extensions/LatestPostsBlock'
import { selectedBlockOf } from '../src/editor/useSelectedBlock'

// Latest Posts (#192): the query block's zero-config sibling. Slash entry inserts the
// dedicated leaf node with EMPTY mdAttrs (zero-config — {% latest-posts /%} round-trips
// clean), the node is inspector-driven, and the canvas preview reuses the query block's
// live content-index seam via an attrs mapping.

describe('slashBlocks — latest posts', () => {
  it('offers Latest Posts in the dynamic group with the "recent" keyword', () => {
    const entry = slashBlocks().find((b) => b.title === 'Latest Posts')
    expect(entry).toBeDefined()
    expect(entry!.group).toBe('dynamic')
    expect(entry!.keywords).toContain('recent')
  })

  it('inserts a latestPostsBlock leaf with empty mdAttrs (zero-config)', () => {
    const entry = slashBlocks().find((b) => b.title === 'Latest Posts')!
    const inserted: unknown[] = []
    const chain = {
      focus: () => chain,
      deleteRange: (_r: unknown) => chain,
      insertContent: (content: unknown) => {
        inserted.push(content)
        return chain
      },
      run: () => true
    }
    entry.run({ chain: () => chain } as never, { from: 0, to: 0 })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      type: 'latestPostsBlock',
      attrs: { mdAttrs: {} }
    })
    expect((inserted[0] as { content?: unknown }).content).toBeUndefined()
  })
})

describe('latestPostsQueryAttrs — preview reuses the query seam', () => {
  it('maps zero-config defaults: 5 newest posts, list, no images', () => {
    expect(latestPostsQueryAttrs({})).toMatchObject({
      collection: 'post',
      sort: 'newest',
      limit: 5,
      layout: 'list',
      columns: 2,
      showImage: false
    })
  })
  it('maps count/filters/layout and coerces the columns enum string', () => {
    expect(
      latestPostsQueryAttrs({
        count: 3,
        category: 'news',
        tag: 'astro',
        layout: 'grid',
        columns: '3',
        showImage: true
      })
    ).toMatchObject({
      limit: 3,
      category: 'news',
      tag: 'astro',
      layout: 'grid',
      columns: 3,
      showImage: true
    })
  })
  it('passes the locale filter through to the index query', () => {
    expect(latestPostsQueryAttrs({ locale: 'fr' })).toMatchObject({
      locale: 'fr'
    })
    // No locale set -> no locale key (the site render then defaults, the
    // preview shows all locales — matching the query block's semantics).
    expect('locale' in latestPostsQueryAttrs({})).toBe(false)
  })
})

describe('selectedBlockOf — inspector opens for latest-posts', () => {
  it('surfaces tag latest-posts + mdAttrs on NodeSelection', () => {
    const e = new Editor({
      extensions: [StarterKit, LatestPostsBlock],
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph' },
          { type: 'latestPostsBlock', attrs: { mdAttrs: { count: 3 } } }
        ]
      }
    })
    e.view.dispatch(
      e.state.tr.setSelection(NodeSelection.create(e.state.doc, 2))
    )
    expect(selectedBlockOf(e.state)).toMatchObject({
      tag: 'latest-posts',
      mdAttrs: { count: 3 }
    })
    e.destroy()
  })
})

describe('NumberControl — numeric display (#192 UAT catch)', () => {
  it('shows a stored numeric value instead of a blank input', async () => {
    const { render, screen } = await import('@testing-library/react')
    const { NumberControl } = await import('../src/editor/controls/text')
    render(
      <NumberControl
        value={5}
        onChange={() => {}}
        meta={{ name: 'count', apiBase: '', onPickMedia: () => {} }}
      />
    )
    expect(screen.getByRole('spinbutton', { name: 'count' })).toHaveValue(5)
  })

  it('enforces contract bounds: min/max attrs on the input, out-of-range clamped', async () => {
    const { render, screen, fireEvent, cleanup } =
      await import('@testing-library/react')
    const { NumberControl } = await import('../src/editor/controls/text')
    cleanup() // the previous test's render stays mounted in this file
    const changes: unknown[] = []
    render(
      <NumberControl
        value={5}
        onChange={(v) => changes.push(v)}
        meta={{
          name: 'count',
          min: 1,
          max: 24,
          apiBase: '',
          onPickMedia: () => {}
        }}
      />
    )
    const input = screen.getByRole('spinbutton', { name: 'count' })
    expect(input).toHaveAttribute('min', '1')
    expect(input).toHaveAttribute('max', '24')
    // 100 -> clamped to the contract max, visible feedback instead of a silent render clamp.
    fireEvent.change(input, { target: { value: '100' } })
    expect(changes.at(-1)).toBe(24)
    // 0 -> clamped up to min.
    fireEvent.change(input, { target: { value: '0' } })
    expect(changes.at(-1)).toBe(1)
    // Clearing still means "unset" (falls back to the contract default downstream).
    fireEvent.change(input, { target: { value: '' } })
    expect(changes.at(-1)).toBe('')
  })
})

import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'
import { latestPostsBlock } from '../src/blocks/standard/latest-posts'
import { STANDARD_BLOCKS } from '../src/blocks/standard'
import { resolveControls } from '../src/blocks/resolve-controls'
import { buildRegistry } from '../src/blocks/registry'
import { generateMarkdocTagsInclude } from '../src/blocks/generate-markdoc'

// Latest Posts is the query block's preset-first sibling (#192): bodyless (self-closing),
// round-tripping as a dedicated leaf `latestPostsBlock` node — NOT the generic body-bearing
// setuBlock (which would inject an empty paragraph and re-emit an open/close tag pair).

const KNOWN = { knownBlockTags: new Set(['latest-posts']) }

describe('latest-posts block round-trip', () => {
  it('maps {% latest-posts /%} to a leaf latestPostsBlock node (no body)', () => {
    const src =
      '{% latest-posts count=3 category="news" tag="astro" layout="grid" columns="3" showDate=false showExcerpt=true showImage=true /%}\n'
    const doc = markdocToTiptap(src, KNOWN)
    const block = doc.content.find((n) => n.type === 'latestPostsBlock')
    expect(block).toBeDefined()
    expect(block!.content).toBeUndefined()
    expect(block!.attrs!.mdAttrs).toMatchObject({
      count: 3,
      category: 'news',
      tag: 'astro',
      layout: 'grid',
      columns: '3',
      showDate: false,
      showExcerpt: true,
      showImage: true
    })
  })

  it('re-emits a self-closing {% latest-posts … /%} with attributes preserved', () => {
    const src = '{% latest-posts count=3 layout="grid" columns="2" /%}\n'
    const out = tiptapToMarkdoc(markdocToTiptap(src, KNOWN))
    expect(out).toContain('{% latest-posts')
    expect(out).toContain('count=3')
    expect(out).toContain('columns="2"')
    expect(out).toContain('/%}')
    expect(out).not.toContain('{% /latest-posts %}')
  })

  it('round-trips the zero-config insert byte-stable', () => {
    const src = '{% latest-posts /%}\n'
    const once = tiptapToMarkdoc(markdocToTiptap(src, KNOWN))
    const twice = tiptapToMarkdoc(markdocToTiptap(once, KNOWN))
    expect(once).toContain('{% latest-posts /%}')
    expect(twice).toBe(once)
  })
})

describe('latest-posts contract', () => {
  it('ships in STANDARD_BLOCKS with a @setu/blocks renderer', () => {
    const entry = STANDARD_BLOCKS.find((b) => b.tag === 'latest-posts')
    expect(entry).toBeDefined()
    expect(entry!.renderer).toBe('@setu/blocks/latest-posts.astro')
  })

  it('slots into the dynamic slash-menu group with the agreed keywords', () => {
    const editor = latestPostsBlock.contract.editor!
    expect(editor.group).toBe('dynamic')
    expect(editor.keywords).toEqual(
      expect.arrayContaining(['recent', 'blog', 'feed', 'posts', 'index'])
    )
  })

  it('resolves real controls: taxonomy pickers, segmented enums, switches', () => {
    const out = resolveControls(
      latestPostsBlock.contract.props,
      latestPostsBlock.contract.editor!.controls
    )
    const by = (n: string) => out.find((c) => c.name === n)!
    expect(by('count').control).toBe('number')
    expect(by('count').default).toBe(5)
    expect(by('category').control).toBe('category')
    expect(by('tag').control).toBe('tag')
    expect(by('layout').control).toBe('select')
    expect(by('layout').options).toEqual(['list', 'grid'])
    expect(by('columns').control).toBe('select')
    expect(by('columns').options).toEqual(['2', '3'])
    expect(by('showDate').control).toBe('switch')
    expect(by('showExcerpt').control).toBe('switch')
    expect(by('showImage').control).toBe('switch')
  })

  it('shows columns only for the grid layout', () => {
    expect(latestPostsBlock.contract.editor!.showWhen).toMatchObject({
      columns: { layout: 'grid' }
    })
  })

  it('declares Content/Layout/Display groups', () => {
    const labels = latestPostsBlock.contract.editor!.groups!.map(
      (g) => g.label
    )
    expect(labels).toEqual(['Content', 'Layout', 'Display'])
  })
})

describe('markdoc codegen with a hyphenated tag', () => {
  it('quotes the latest-posts key so the generated include is valid JS', () => {
    const registry = buildRegistry([
      {
        tag: 'latest-posts',
        component: '@setu/blocks/latest-posts.astro',
        contract: latestPostsBlock.contract
      }
    ])
    const src = generateMarkdocTagsInclude(registry)
    expect(src).toContain(`'latest-posts': {`)
    // The emitted module must parse — a bare `latest-posts:` key is a syntax error.
    const script = src
      .replace(/^import .*$/m, 'const component = (x) => x')
      .replace(/^export /m, '')
    expect(() => new Function(script)).not.toThrow()
  })
})

import { describe, it, expect } from 'vitest'
// Via @astrojs/markdoc's own re-export, exactly as preview.astro imports it — apps/site
// has no direct @markdoc/markdoc dependency and does not need one.
import { Markdoc } from '@astrojs/markdoc/config'
import { resolveComponentImports, setupConfig } from '@astrojs/markdoc/runtime'
import markdocConfig from '../markdoc.config.mjs'

/**
 * #769, the preview half — and a guard on the trap that made the first cut of the fix a
 * silent no-op.
 *
 * `render.test.ts` proves the PUBLISHED page through a real `astro build`. The in-editor
 * Preview (`src/preview/preview.astro`) is the other consumer of this same config, and it
 * reaches the renderer by a different route: `createContentComponent`, which runs
 * `setupConfig` and then `resolveComponentImports`. That second step is the trap —
 * resolving a `render: component(...)` descriptor REWRITES `config.nodes[key].render`, and
 * it silently `delete`s any custom `transform` whose SOURCE TEXT its `transformRespectsRender`
 * check cannot see reading that field back (a literal `.toString().includes()` on the
 * function body). A perfectly correct transform that reads `config.nodes?.[node.type]?.render`
 * is dropped, with no error, and the cell renders the broken way.
 *
 * So this drives the preview's exact resolve path and asserts the transform survives it and
 * still produces real `br` tags. Without it, the next refactor that "tidies" the two
 * near-identical `tdTransform`/`thTransform` into one shared helper would ship #769 again
 * with a fully green build.
 */
const CELL_SRC = '| H1 | H2 |\n| --- | --- |\n| one<br>two | **a**<br>b |\n'

/** #785 — a `<br>` inside a CODE SPAN is not a fold and must stay literal. Markdoc gives
 *  a code span its payload as an attribute with no children, so this renderer never
 *  touched it; the reader in @setu/core used to split it anyway (a code span is a text
 *  node carrying a `code` mark there), which rewrote the cell on save and turned one
 *  `<code>` element into two. This pins the renderer half of the agreement. */
const CODE_SRC = '| H1 |\n| --- |\n| `a<br>b` |\n'

/** The transformed tree, resolved exactly as the preview resolves it. */
async function transformAsPreviewDoes(src: string = CELL_SRC): Promise<unknown> {
  // The preview maps th/td to real .astro components; the resolve step only cares that
  // the key is PRESENT (it overwrites `render` with whatever it is handed), so plain
  // strings stand in for the components here and keep this a pure-node test. The casts
  // exist because that map is typed for Astro component factories.
  const nodeComponentMap = { th: 'th', td: 'td' } as unknown as Parameters<
    typeof resolveComponentImports
  >[2]
  const config = resolveComponentImports(
    await setupConfig(markdocConfig, {}),
    {},
    nodeComponentMap
  )
  return Markdoc.transform(
    Markdoc.parse(src),
    config as Parameters<typeof Markdoc.transform>[1]
  )
}

/** Every tag name in a transformed Markdoc tree, depth-first. */
function tagNames(node: unknown, out: string[] = []): string[] {
  if (Markdoc.Tag.isTag(node)) {
    if (typeof node.name === 'string') out.push(node.name)
    for (const child of node.children ?? []) tagNames(child, out)
  } else if (Array.isArray(node)) {
    for (const child of node) tagNames(child, out)
  }
  return out
}

/** Every string leaf in a transformed Markdoc tree. */
function textLeaves(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node)
  else if (Markdoc.Tag.isTag(node)) {
    for (const child of node.children ?? []) textLeaves(child, out)
  } else if (Array.isArray(node)) {
    for (const child of node) textLeaves(child, out)
  }
  return out
}

describe('preview render path — folded table-cell breaks (#769)', () => {
  it('keeps the td/th transform alive through resolveComponentImports', async () => {
    const tree = await transformAsPreviewDoes()
    // Four folded fragments across two cells → two `br` tags.
    expect(tagNames(tree).filter((n) => n === 'br')).toHaveLength(2)
  })

  it('leaves no literal <br> in the text, and keeps the mark split', async () => {
    const tree = await transformAsPreviewDoes()
    const text = textLeaves(tree)
    expect(text.some((t) => t.includes('<br>'))).toBe(false)
    expect(text).toContain('one')
    expect(text).toContain('two')
    // `**a**<br>b` splits with the strong mark intact on the left side only.
    expect(tagNames(tree)).toContain('strong')
    expect(text).toContain('b')
  })
})

describe('preview render path — a code span in a cell (#785)', () => {
  it('leaves a <br> inside a code span literal, in ONE code element', async () => {
    const tree = await transformAsPreviewDoes(CODE_SRC)
    const names = tagNames(tree)
    expect(names.filter((n) => n === 'code')).toHaveLength(1)
    expect(names).not.toContain('br')
  })

  /** The payload is a CHILD string, not an attribute — the shape the old comment here
   *  got wrong, and the reason the recursion reached inside the span at all. */
  it('carries the whole span, breaks and all, as one child string', async () => {
    const tree = await transformAsPreviewDoes(CODE_SRC)
    const codes: unknown[] = []
    const walk = (n: unknown): void => {
      if (Markdoc.Tag.isTag(n)) {
        if (n.name === 'code') codes.push(n.children)
        else for (const c of n.children ?? []) walk(c)
      } else if (Array.isArray(n)) for (const c of n) walk(c)
    }
    walk(tree)
    expect(codes).toEqual([['a<br>b']])
  })
})

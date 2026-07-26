import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { markdocToTiptap } from '../src/markdoc/to-tiptap'
import { tiptapToMarkdoc } from '../src/markdoc/to-markdoc'
import { STANDARD_BLOCKS } from '../src/blocks/standard'

/**
 * #967 — a body-bearing Markdoc tag written on ONE line
 * (`{% button %}Get started{% /button %}`, the shape `content/post/en/kitchen-sink.mdoc`
 * ships and every dev sandbox is seeded with) was deleted, tag and inner text both, on
 * the first open→save. Markdoc parses that shape as an INLINE tag inside a paragraph, and
 * `inlineToTiptap` returned `[]` for every tag but `sub`/`sup`.
 *
 * It survived review because coverage was per-tag and per-SHAPE: the button test asserted
 * byte-stability for the `\n`-wrapped form only — the shape that works — so the shape that
 * ships was never converted. This table is therefore driven by tag × shape, and the tag
 * list is DERIVED from the same two sources the production registry unions
 * (`apps/admin/src/blocks/registry.ts`), never hand-listed: a hardcoded list drifts the
 * moment a block folder is added, which is exactly how #970's registry guard came to
 * generate zero tests for a missing block.
 */

/** Repo-root `blocks/<tag>/` folders — the auto-discovered half of the block registry. */
const folderBlockTags = readdirSync(resolve(__dirname, '../../../blocks'), {
  withFileTypes: true
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

/** Every tag the editor treats as a block, unioned exactly as `buildRegistry` +
 *  `mergeBlockSources` do in `apps/admin/src/blocks/registry.ts`. `image` is appended for
 *  the same reason that file appends it (line 33): it has a dedicated editor node but no
 *  block folder. The production set itself is covered by
 *  `apps/admin/test/registry-single-line-tags.test.ts`, which iterates
 *  `registry.knownBlockTags` and so cannot drift from this list unnoticed. */
const TAGS = [
  ...new Set([
    ...STANDARD_BLOCKS.map((block) => block.tag),
    ...folderBlockTags,
    'image'
  ])
]

const known = new Set(TAGS)
const roundTrip = (src: string): string =>
  tiptapToMarkdoc(markdocToTiptap(src, { knownBlockTags: known })).trimEnd()

describe('single-line tag table — derivation guard', () => {
  // #970's lesson: a derivation that silently yields nothing generates zero tests and
  // reads as coverage. Assert the shape of the derived list, not just that it is truthy.
  it('derives a plausible tag list from both registry sources', () => {
    expect(folderBlockTags.length).toBeGreaterThan(0)
    expect(STANDARD_BLOCKS.length).toBeGreaterThan(0)
    expect(TAGS.length).toBeGreaterThanOrEqual(10)
    // One representative of each source, so a broken glob/import turns red by name.
    expect(TAGS).toContain('button') // STANDARD_BLOCKS
    expect(TAGS).toContain('callout') // blocks/callout/
    expect(TAGS).toContain('notice') // blocks/notice/
    expect(TAGS).toContain('image') // registry.knownBlockTags.add('image')
  })
})

describe('every block tag round-trips in BOTH written shapes (#967)', () => {
  for (const tag of TAGS) {
    const shapes = {
      'single-line': `{% ${tag} %}BODYTEXT{% /${tag} %}`,
      'single-line + attrs': `{% ${tag} href="/x" %}BODYTEXT{% /${tag} %}`,
      'multi-line': `{% ${tag} %}\nBODYTEXT\n{% /${tag} %}`,
      'multi-line + attrs': `{% ${tag} href="/x" %}\nBODYTEXT\n{% /${tag} %}`
    }
    describe(`{% ${tag} %}`, () => {
      for (const [shape, src] of Object.entries(shapes)) {
        it(`${shape}: keeps the body text and the tag`, () => {
          const out = roundTrip(src)
          expect(out).toContain('BODYTEXT')
          expect(out).toContain(`{% ${tag}`)
          expect(out).toContain(`{% /${tag} %}`)
        })
        it(`${shape}: round-trips byte-identically`, () => {
          expect(roundTrip(src)).toBe(src)
        })
        it(`${shape}: is stable on a second save`, () => {
          expect(roundTrip(roundTrip(src))).toBe(roundTrip(src))
        })
      }
    })
  }
})

describe('an UNREGISTERED tag falls back to the passthrough safety net', () => {
  const shapes = {
    'single-line': '{% zzz a="b" %}BODYTEXT{% /zzz %}',
    'multi-line': '{% zzz a="b" %}\nBODYTEXT\n{% /zzz %}'
  }
  for (const [shape, src] of Object.entries(shapes)) {
    it(`${shape}: preserved verbatim as a visible passthrough node`, () => {
      const doc = markdocToTiptap(src, { knownBlockTags: known })
      expect(doc.content.map((n) => n.type)).toEqual(['passthrough'])
      expect(doc.content[0]!.attrs).toEqual({ raw: src, flagged: false })
      expect(roundTrip(src)).toBe(src)
    })
  }
})

describe('the shipped fixture shape', () => {
  const src =
    '{% button href="/signup" variant="primary" %}Get started{% /button %}'

  it('is an editable button block in the canvas, not a passthrough', () => {
    const doc = markdocToTiptap(src, { knownBlockTags: known })
    expect(doc.content).toHaveLength(1)
    const block = doc.content[0]!
    expect(block.type).toBe('setuBlock')
    expect(block.attrs).toEqual({
      tag: 'button',
      mdAttrs: { href: '/signup', variant: 'primary' },
      inlineBody: true
    })
    // The body is a real editable paragraph, not chrome.
    expect(block.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Get started' }] }
    ])
  })

  it('round-trips byte-identically', () => {
    expect(roundTrip(src)).toBe(src)
  })

  it('serializes the multi-line form when the body grows past one paragraph', () => {
    const doc = markdocToTiptap(src, { knownBlockTags: known })
    const block = doc.content[0]!
    // What the editor produces the moment an author presses Enter inside the body.
    const edited = {
      ...doc,
      content: [
        {
          ...block,
          content: [
            ...(block.content ?? []),
            { type: 'paragraph', content: [{ type: 'text', text: 'second' }] }
          ]
        }
      ]
    }
    expect(tiptapToMarkdoc(edited).trimEnd()).toBe(
      '{% button href="/signup" variant="primary" %}\nGet started\n\nsecond\n{% /button %}'
    )
  })

  it('degrades to the multi-line form — never to deletion — if the editor drops the attr', () => {
    const doc = markdocToTiptap(src, { knownBlockTags: known })
    const block = doc.content[0]!
    const attrs = { ...(block.attrs ?? {}) }
    delete attrs['inlineBody']
    const stripped = { ...doc, content: [{ ...block, attrs }] }
    expect(tiptapToMarkdoc(stripped).trimEnd()).toBe(
      '{% button href="/signup" variant="primary" %}\nGet started\n{% /button %}'
    )
  })
})

describe('a tag mixed with other inline content in one paragraph', () => {
  // The Tiptap schema has no inline node for a block-level tag: `paragraph` is `inline*`
  // and `setuBlock`/`callout` are `group: 'block'`. So the paragraph degrades to a VISIBLE
  // passthrough rather than dropping the tag — the #664 escape hatch, reached from the
  // inline side.
  const src = 'Text with {% button href="/x" %}Go{% /button %} inline.'

  it('is preserved verbatim as a passthrough', () => {
    const doc = markdocToTiptap(src, { knownBlockTags: known })
    expect(doc.content.map((n) => n.type)).toEqual(['passthrough'])
    expect(roundTrip(src)).toBe(src)
  })

  it('is preserved inside a tag body too, where no source slice is available', () => {
    const nested = `{% callout %}\n${src}\n{% /callout %}`
    const doc = markdocToTiptap(nested, { knownBlockTags: known })
    expect(doc.content[0]!.content?.map((n) => n.type)).toEqual(['passthrough'])
    expect(roundTrip(nested)).toBe(nested)
  })

  it('is preserved when the tag sits inside a mark', () => {
    const marked = '**{% button href="/x" %}Go{% /button %}**'
    expect(roundTrip(marked)).toBe(marked)
  })
})

describe('single-line tags nested inside other blocks', () => {
  it('survives inside a callout body', () => {
    const src =
      '{% callout type="info" %}\n{% button href="/x" %}Go{% /button %}\n{% /callout %}'
    expect(roundTrip(src)).toBe(src)
  })

  it('survives inside a blockquote', () => {
    const src = '> {% button href="/x" %}Go{% /button %}'
    const out = roundTrip(src)
    expect(out).toContain('Go')
    expect(out).toContain('{% button')
  })

  it('survives inside a list item, byte-identically', () => {
    const src = '- {% button href="/x" %}Go{% /button %}'
    expect(roundTrip(src)).toBe(src)
  })

  it('survives inside a task item, and converges on the second save', () => {
    // The `[x] ` marker occupies the marker line, so the tag has to move to a line of its
    // own — a ONE-TIME re-spelling (the #772 shape), never a deletion. Byte-stable after.
    const src = '- [x] {% button href="/x" %}Go{% /button %}'
    const once = roundTrip(src)
    expect(once).toContain('{% button href="/x" %}Go{% /button %}')
    expect(once).toContain('- [x]')
    expect(roundTrip(once)).toBe(once)
  })

  it('survives inside a nested ordered list', () => {
    const src = '1. {% notice tone="success" %}Heads up{% /notice %}'
    expect(roundTrip(src)).toBe(src)
  })
})

describe('shapes the single-line handling must NOT disturb', () => {
  it('leaves the sub/sup inline MARK tags alone', () => {
    const src = 'Water is H{% sub %}2{% /sub %}O; E = mc{% sup %}2{% /sup %}.'
    const doc = markdocToTiptap(src, { knownBlockTags: known })
    expect(doc.content[0]!.type).toBe('paragraph')
    expect(roundTrip(src)).toBe(src)
  })

  it('keeps a paragraph alignment annotation on a single-line tag line', () => {
    const src = '{% button href="/x" %}Go{% /button %}{% align="center" %}'
    expect(roundTrip(src)).toBe(src)
  })

  it('leaves an ordinary paragraph a paragraph', () => {
    const src =
      'A paragraph with **bold**, *italic*, and a [link](https://a.example).'
    const doc = markdocToTiptap(src, { knownBlockTags: known })
    expect(doc.content[0]!.type).toBe('paragraph')
    expect(roundTrip(src)).toBe(src)
  })

  it('leaves a self-closing atom tag an atom node', () => {
    const src = '{% hero title="Hi" /%}'
    const doc = markdocToTiptap(src, { knownBlockTags: known })
    expect(doc.content[0]!.type).toBe('heroBlock')
    expect(roundTrip(src)).toBe(src)
  })
})

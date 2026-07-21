import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Node } from '@tiptap/core'
import type { Editor, Extensions, JSONContent } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { ATOM_TAG_TO_NODE } from '@setu/core'
import { blockCores } from '@setu/blocks'
import {
  buildBlockExtensions,
  insertPayloadForTag
} from '../src/editor/block-registry'
import { registry } from '../src/blocks/registry'
import { GalleryBlock } from '../src/editor/extensions/GalleryBlock'
import { HeroBlock } from '../src/editor/extensions/HeroBlock'
import { VideoBlock } from '../src/editor/extensions/VideoBlock'
import { QueryBlock } from '../src/editor/extensions/QueryBlock'
import { LatestPostsBlock } from '../src/editor/extensions/LatestPostsBlock'
import { EmbedBlock } from '../src/editor/extensions/EmbedBlock'
import { ContactBlock } from '../src/editor/extensions/ContactBlock'
import '../src/styles/tokens.css'
import '../src/styles/editor.css'

// ---------------------------------------------------------------------------------
// #778 — atom blocks whose ONLY editing UI is the inspector rail must show, in the
// canvas, which one is selected. `atomCoreView` (the #562 shared factory) never read
// `selected`, so gallery/hero/video rendered no affordance at all, and `.ProseMirror-
// selectednode` had zero styling rules to fall back on.
//
// Browser-mode because this is paint + selection (CLAUDE.md §4 #3): jsdom neither
// applies the stylesheet cascade meaningfully nor reflects ProseMirror's real
// selection DOM. Asserting the class alone would be vacuous — a class nothing styles
// is exactly the bug — so each case also checks the outline actually computes.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

function Harness({
  extensions,
  content
}: {
  extensions: Extensions
  content: JSONContent
}) {
  const editor = useEditor({ immediatelyRender: false, extensions, content })
  ;(
    window as unknown as { __setuTestEditor?: Editor | null }
  ).__setuTestEditor = editor
  return <EditorContent editor={editor} />
}

const testEditor = () => {
  const editor = (window as unknown as { __setuTestEditor?: Editor })
    .__setuTestEditor
  if (!editor) throw new Error('test editor was not exposed on window')
  return editor
}

const wrapperFor = (tag: string) =>
  document.querySelector(`.setu-block[data-tag="${tag}"]`) as HTMLElement

const selectNode = (editor: Editor, pos: number) =>
  editor.view.dispatch(
    editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos))
  )

const deselect = (editor: Editor) =>
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1))
  )

/** Each atom: [markdoc tag, tiptap node name, extension, mdAttrs]. */
const ATOMS: Array<
  [string, string, Extensions[number], Record<string, unknown>]
> = [
  ['gallery', 'galleryBlock', GalleryBlock, { images: [] }],
  ['hero', 'heroBlock', HeroBlock, { headline: 'Hero headline' }],
  ['video', 'videoBlock', VideoBlock, { src: '/media/x.mp4' }],
  ['query', 'queryBlock', QueryBlock, { collection: 'post' }],
  ['latest-posts', 'latestPostsBlock', LatestPostsBlock, { limit: 3 }]
]

describe.each(ATOMS)(
  '#778 canvas selection state — %s',
  (tag, nodeName, extension, mdAttrs) => {
    it(`marks the .setu-block wrapper selected for ${tag} and clears it on deselect`, async () => {
      render(
        <Harness
          extensions={[StarterKit, extension]}
          content={{
            type: 'doc',
            content: [
              { type: 'paragraph' },
              { type: nodeName, attrs: { mdAttrs } }
            ]
          }}
        />
      )
      await expect.poll(() => wrapperFor(tag)).toBeTruthy()

      const editor = testEditor()
      const wrapper = wrapperFor(tag)
      expect(wrapper.classList.contains('is-selected')).toBe(false)

      selectNode(editor, 2)
      await new Promise((r) => setTimeout(r, 0))

      const selected = wrapperFor(tag)
      expect(
        selected.classList.contains('is-selected'),
        `${tag} should carry is-selected while node-selected`
      ).toBe(true)
      // A class nothing styles is the bug — prove it actually paints.
      const style = getComputedStyle(selected)
      expect(style.outlineStyle).not.toBe('none')
      expect(parseFloat(style.outlineWidth)).toBeGreaterThan(0)

      deselect(editor)
      await new Promise((r) => setTimeout(r, 0))
      expect(wrapperFor(tag).classList.contains('is-selected')).toBe(false)
      expect(getComputedStyle(wrapperFor(tag)).outlineStyle).toBe('none')
    })
  }
)

// The embed and contact views are bespoke cards, not `.setu-block` — they carry the
// shared ring through `.setu-canvas-card`. Checked individually because the issue's
// "also check latest-posts / query / embed" is exactly the class of gap that produced
// this bug: a shared factory fixed, and the hand-written siblings left behind.
describe.each([
  [
    'embed',
    'embedBlock',
    EmbedBlock,
    { url: 'https://example.com/v', title: 'Clip' }
  ],
  ['contact', 'contactBlock', ContactBlock, { formLabel: 'Contact' }]
] as Array<[string, string, Extensions[number], Record<string, unknown>]>)(
  '#778 canvas selection state — %s (bespoke card view)',
  (tag, nodeName, extension, mdAttrs) => {
    it(`rings the ${tag} card while node-selected`, async () => {
      render(
        <Harness
          extensions={[StarterKit, extension]}
          content={{
            type: 'doc',
            content: [
              { type: 'paragraph' },
              { type: nodeName, attrs: { mdAttrs } }
            ]
          }}
        />
      )
      const card = () =>
        document.querySelector('.setu-canvas-card') as HTMLElement
      await expect.poll(card).toBeTruthy()
      expect(card().classList.contains('is-selected')).toBe(false)

      selectNode(testEditor(), 2)
      await new Promise((r) => setTimeout(r, 0))
      expect(card().classList.contains('is-selected')).toBe(true)
      const style = getComputedStyle(card())
      expect(style.outlineStyle).not.toBe('none')
      expect(parseFloat(style.outlineWidth)).toBeGreaterThan(0)

      deselect(testEditor())
      await new Promise((r) => setTimeout(r, 0))
      expect(card().classList.contains('is-selected')).toBe(false)
    })
  }
)

// ---------------------------------------------------------------------------------
// #786 — the ring above is convention, not a guard. The list of atoms up there is
// hard-coded, so a block added tomorrow is simply not covered, and there was no
// `.ProseMirror-selectednode` fallback, so a bespoke view that forgets `is-selected`
// renders NO affordance with a fully green suite — the exact shape of #778.
//
// Two structural closures, both browser-mode (paint + real selection DOM):
//  1. a property over the REGISTRY, so a new atom is covered on arrival;
//  2. the fallback itself, proven on a node view that carries no Setu class at all.
// ---------------------------------------------------------------------------------

/** Every style that could carry a selection affordance, for an element subtree. */
function affordanceSnapshot(root: HTMLElement): string[] {
  const els = [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[]
  return els.map((el) => {
    const s = getComputedStyle(el)
    return [
      s.outlineStyle,
      s.outlineWidth,
      s.outlineColor,
      s.borderColor,
      s.borderStyle,
      s.boxShadow,
      s.opacity
    ].join('|')
  })
}

const registryExtensions = [
  StarterKit,
  ...buildBlockExtensions({ blocks: registry.blocks, blockCores })
]

function RegistryHarness() {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: registryExtensions,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: { class: 'setu-prose', 'aria-label': 'Content editor' }
    }
  })
  ;(
    window as unknown as { __setuTestEditor?: Editor | null }
  ).__setuTestEditor = editor
  return <EditorContent editor={editor} />
}

const selectFirstOfType = (editor: Editor, nodeType: string): void => {
  let pos = -1
  editor.state.doc.descendants((n, p) => {
    if (pos === -1 && n.type.name === nodeType) pos = p
  })
  if (pos === -1) throw new Error(`no ${nodeType} node found to select`)
  editor.view.dispatch(
    editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos))
  )
}

describe.each(Object.keys(ATOM_TAG_TO_NODE))(
  '#786 every registry atom paints SOME selection affordance — %s',
  (tag) => {
    const node = ATOM_TAG_TO_NODE[tag]!
    it(`${tag} looks different in the canvas while node-selected`, async () => {
      render(<RegistryHarness />)
      await expect
        .element(page.getByLabelText('Content editor'))
        .toBeInTheDocument()
      const editor = testEditor()
      // `embed` is paste-driven and has no cold slash payload (see #563's wiring test).
      editor
        .chain()
        .focus()
        .insertContent(
          tag === 'embed'
            ? { type: node, attrs: { mdAttrs: {} } }
            : insertPayloadForTag(tag)
        )
        .run()
      // insertContent leaves the fresh atom node-SELECTED, which would make the
      // before/after snapshot compare selected against selected — vacuous.
      deselect(editor)
      await new Promise((r) => setTimeout(r, 250)) // node view mount + transitions

      const canvas = document.querySelector('.ProseMirror') as HTMLElement
      const before = affordanceSnapshot(canvas)

      selectFirstOfType(editor, node)
      await new Promise((r) => setTimeout(r, 250)) // 0.15s transitions settle

      const after = affordanceSnapshot(canvas)
      // The property, not the mechanism: outline ring, border tint, revealed label —
      // any of them is fine, silence is not. A new atom that renders nothing on
      // selection fails here the day it lands, instead of shipping like #778 did.
      expect(
        after.length === before.length && after.some((s, i) => s !== before[i]),
        `selecting {% ${tag} %} changed nothing visible in the canvas`
      ).toBe(true)
    })
  }
)

/** An atom whose view carries none of the Setu selection classes — the "next bespoke
 *  view forgets" case #786 is about. */
const BespokeAtom = Node.create({
  name: 'bespokeAtom',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-bespoke]' }],
  renderHTML: () => ['div', { 'data-bespoke': '', class: 'bespoke' }, 'bespoke']
})

describe('#786 .ProseMirror-selectednode fallback', () => {
  it('rings a selectable node whose view sets no Setu class at all', async () => {
    render(
      <Harness
        extensions={[StarterKit, BespokeAtom]}
        content={{
          type: 'doc',
          content: [{ type: 'paragraph' }, { type: 'bespokeAtom' }]
        }}
      />
    )
    const el = () => document.querySelector('[data-bespoke]') as HTMLElement
    await expect.poll(el).toBeTruthy()
    expect(getComputedStyle(el()).outlineStyle).toBe('none')

    selectNode(testEditor(), 2)
    await new Promise((r) => setTimeout(r, 0))

    const selected = document.querySelector(
      '.ProseMirror-selectednode'
    ) as HTMLElement
    expect(selected).toBeTruthy()
    const style = getComputedStyle(selected)
    expect(style.outlineStyle).not.toBe('none')
    expect(parseFloat(style.outlineWidth)).toBeGreaterThan(0)
    expect(style.outlineColor).not.toBe('rgba(0, 0, 0, 0)')
  })

  it('does not double-ring a block that already handles its own selection', async () => {
    render(
      <Harness
        extensions={[StarterKit, HeroBlock]}
        content={{
          type: 'doc',
          content: [
            { type: 'paragraph' },
            { type: 'heroBlock', attrs: { mdAttrs: { headline: 'Ringed' } } }
          ]
        }}
      />
    )
    await expect
      .element(page.getByRole('heading', { name: 'Ringed' }))
      .toBeInTheDocument()
    selectNode(testEditor(), 2)
    await new Promise((r) => setTimeout(r, 0))

    // The inner .setu-block keeps the one ring #778 established…
    expect(getComputedStyle(wrapperFor('hero')).outlineStyle).not.toBe('none')
    // …and the outer ProseMirror wrapper stays bare, so the look is unchanged.
    const outer = document.querySelector(
      '.ProseMirror-selectednode'
    ) as HTMLElement
    expect(outer.classList.contains('setu-block')).toBe(false)
    expect(getComputedStyle(outer).outlineStyle).toBe('none')
  })
})

describe('#778 the selection ring reads in dark mode too', () => {
  it('computes a visible outline under [data-theme="dark"]', async () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    try {
      render(
        <Harness
          extensions={[StarterKit, HeroBlock]}
          content={{
            type: 'doc',
            content: [
              { type: 'paragraph' },
              {
                type: 'heroBlock',
                attrs: { mdAttrs: { headline: 'Dark hero' } }
              }
            ]
          }}
        />
      )
      await expect
        .element(page.getByRole('heading', { name: 'Dark hero' }))
        .toBeInTheDocument()
      selectNode(testEditor(), 2)
      await new Promise((r) => setTimeout(r, 0))
      const style = getComputedStyle(wrapperFor('hero'))
      expect(style.outlineStyle).not.toBe('none')
      expect(parseFloat(style.outlineWidth)).toBeGreaterThan(0)
      // The ring colour must resolve (not `transparent` / empty) in the dark palette.
      expect(style.outlineColor).not.toBe('rgba(0, 0, 0, 0)')
    } finally {
      document.documentElement.removeAttribute('data-theme')
    }
  })
})

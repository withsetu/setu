import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor, Extensions, JSONContent } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
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

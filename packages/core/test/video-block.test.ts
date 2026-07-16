import { describe, it, expect } from 'vitest'
import { STANDARD_BLOCKS } from '../src/blocks/standard'
import { resolveControls } from '../src/blocks/resolve-controls'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

// markdocToTiptap accepts a raw Markdoc string (parses internally); tiptapToMarkdoc
// accepts a TiptapDoc and returns a Markdoc string. Mirrors hero-block.test.ts.

const KNOWN = { knownBlockTags: new Set(['video']) }

describe('video block (#178)', () => {
  it('is registered as a standard block with media group + keywords', () => {
    const video = STANDARD_BLOCKS.find((b) => b.tag === 'video')
    expect(video).toBeDefined()
    expect(video!.renderer).toBe('@setu/blocks/video.astro')
    expect(video!.contract.editor?.group).toBe('media')
    expect(video!.contract.editor?.keywords).toEqual(
      expect.arrayContaining(['mp4', 'movie', 'player', 'clip'])
    )
  })

  it('src picks video media, poster picks image media, toggles are switches', () => {
    const video = STANDARD_BLOCKS.find((b) => b.tag === 'video')!
    const ed = video.contract.editor!
    expect(ed.controls!.src).toBe('video')
    expect(ed.controls!.poster).toBe('media')
    expect(ed.controls!.controls).toBe('switch')
    expect(ed.controls!.autoplay).toBe('switch')
    expect(ed.controls!.loop).toBe('switch')
    expect(ed.controls!.muted).toBe('switch')
    expect(ed.controls!.width).toBe('align')
  })

  it('forces muted (disabled, with a hint) while autoplay is on', () => {
    const video = STANDARD_BLOCKS.find((b) => b.tag === 'video')!
    const rule = video.contract.editor!.forcedWhen!.muted!
    expect(rule.when).toEqual({ autoplay: true })
    expect(rule.value).toBe(true)
    expect(rule.hint).toBeTruthy()
  })

  it('resolveControls accepts the video hint on a plain string prop', () => {
    const video = STANDARD_BLOCKS.find((b) => b.tag === 'video')!
    const controls = resolveControls(
      video.contract.props,
      video.contract.editor?.controls
    )
    expect(controls.find((c) => c.name === 'src')?.control).toBe('video')
    expect(controls.find((c) => c.name === 'controls')?.default).toBe(true)
  })

  it('round-trips a short {% video /%} byte-stable and self-closing', () => {
    const src = '{% video src="/media/clip.mp4" loop=true /%}\n'
    const doc = markdocToTiptap(src, KNOWN)
    const video = doc.content.find((n) => n.type === 'videoBlock')
    expect(video).toBeDefined()
    expect(video!.attrs!.mdAttrs).toMatchObject({
      src: '/media/clip.mp4',
      loop: true
    })
    expect(tiptapToMarkdoc(doc)).toBe(src)
  })

  it('serialize → reopen → serialize is a fixpoint with every attr intact', () => {
    const src =
      '{% video src="/media/2026/07/clip.mp4" poster="/media/2026/07/poster.webp" caption="A clip" autoplay=true loop=true /%}\n'
    const once = tiptapToMarkdoc(markdocToTiptap(src, KNOWN))
    const twice = tiptapToMarkdoc(markdocToTiptap(once, KNOWN))
    expect(twice).toBe(once)
    const reopened = markdocToTiptap(once, KNOWN).content.find(
      (n) => n.type === 'videoBlock'
    )
    expect(reopened!.attrs!.mdAttrs).toEqual({
      src: '/media/2026/07/clip.mp4',
      poster: '/media/2026/07/poster.webp',
      caption: 'A clip',
      autoplay: true,
      loop: true
    })
  })
})

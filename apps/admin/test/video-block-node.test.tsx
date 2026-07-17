import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { VideoBlock } from '../src/editor/extensions/VideoBlock'

afterEach(cleanup)

function Harness({ mdAttrs }: { mdAttrs: Record<string, unknown> }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, VideoBlock],
    content: {
      type: 'doc',
      content: [{ type: 'videoBlock', attrs: { mdAttrs } }]
    }
  })
  return <EditorContent editor={editor} />
}

describe('VideoBlock node view', () => {
  it('renders the inviting placeholder when no src is set (no undefined on screen)', async () => {
    render(<Harness mdAttrs={{}} />)
    expect(await screen.findByText(/no video yet/i)).toBeTruthy()
    expect(document.querySelector('.blk-video-empty')).toBeTruthy()
    expect(document.body.textContent).not.toContain('undefined')
  })

  it('renders the player with a resolved /media src and caption', async () => {
    render(
      <Harness
        mdAttrs={{ src: '/media/2026/07/clip.mp4', caption: 'A clip' }}
      />
    )
    expect(await screen.findByText('A clip')).toBeTruthy()
    const video = document.querySelector<HTMLVideoElement>('.blk-video-player')
    expect(video).toBeTruthy()
    // root-relative srcs resolve against the media origin for display
    expect(video!.getAttribute('src')).toMatch(
      /^http.+\/media\/2026\/07\/clip\.mp4$/
    )
  })

  it('forces muted in the canvas when autoplay is on', async () => {
    render(<Harness mdAttrs={{ src: '/media/clip.mp4', autoplay: true }} />)
    await screen.findByRole('figure')
    const video = document.querySelector<HTMLVideoElement>('.blk-video-player')
    expect(video!.muted).toBe(true)
    expect(video!.hasAttribute('autoplay')).toBe(false)
  })
})

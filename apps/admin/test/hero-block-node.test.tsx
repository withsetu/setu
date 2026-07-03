import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { HeroBlock } from '../src/editor/extensions/HeroBlock'

afterEach(cleanup)

function Harness({ mdAttrs }: { mdAttrs: Record<string, unknown> }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, HeroBlock],
    content: {
      type: 'doc',
      content: [{ type: 'heroBlock', attrs: { mdAttrs } }]
    }
  })
  return <EditorContent editor={editor} />
}

describe('HeroBlock node view', () => {
  it('renders the hero headline read-only in the canvas', async () => {
    render(<Harness mdAttrs={{ headline: 'Welcome', layout: 'centered' }} />)
    expect(await screen.findByText('Welcome')).toBeTruthy()
    expect(document.querySelector('.blk-hero')).toBeTruthy()
  })

  it('renders the hero with its layout + headline', async () => {
    render(
      <Harness
        mdAttrs={{
          headline: 'Hi',
          layout: 'background',
          textPosition: 'bottom-left'
        }}
      />
    )
    expect(await screen.findByText('Hi')).toBeTruthy()
    expect(
      document.querySelector('.blk-hero.layout-background.pos-bottom-left')
    ).toBeTruthy()
  })
})

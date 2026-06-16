import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { TurnIntoMenu } from '../src/editor/TurnIntoMenu'

afterEach(cleanup)

function H({ onReady }: { onReady: (e: Editor) => void }) {
  const e = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false })],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
  })
  if (e) onReady(e)
  return <>{e && <TurnIntoMenu editor={e} />}</>
}

describe('TurnIntoMenu', () => {
  it('shows the current block type and turns the block into a heading', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).run() })
    const trigger = screen.getByRole('button', { name: /turn into/i })
    expect(trigger).toHaveTextContent('Text')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitemradio', { name: /heading 3/i }))
    expect(editor.isActive('heading', { level: 3 })).toBe(true)
  })

  it('Escape in the menu closes it without collapsing the selection', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).run() })
    fireEvent.click(screen.getByRole('button', { name: /turn into/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(editor.state.selection.empty).toBe(false)
  })
})

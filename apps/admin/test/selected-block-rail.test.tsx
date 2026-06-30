import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { HeroBlock } from '../src/editor/extensions/HeroBlock'
import { selectedBlockOf, useSelectedBlock } from '../src/editor/useSelectedBlock'

function makeEditor() {
  // A leading paragraph gives the initial cursor a text node to land in, so the
  // default selection is a TextSelection (not a NodeSelection on heroBlock).
  return new Editor({ extensions: [StarterKit, HeroBlock],
    content: { type: 'doc', content: [{ type: 'paragraph' }, { type: 'heroBlock', attrs: { mdAttrs: { headline: 'Hi', layout: 'centered' } } }] } })
}

describe('selectedBlockOf', () => {
  it('returns null when no block is selected', () => {
    const e = makeEditor()
    expect(selectedBlockOf(e.state)).toBeNull()
    e.destroy()
  })
  it('returns the hero tag + mdAttrs when the heroBlock node is selected', () => {
    const e = makeEditor()
    // heroBlock is the second top-level child; its start pos = 1 (para open) + 1 (para close) = 2
    const heroPos = e.state.doc.resolve(2).before(1) // pos before the heroBlock node
    // Use NodeSelection.create with the node's position (the para is at pos 0-2, heroBlock at pos 2)
    const nodePos = 2 // after the empty paragraph (open=1, close=2)
    const tr = e.state.tr.setSelection(NodeSelection.create(e.state.doc, nodePos))
    e.view.dispatch(tr)
    const sel = selectedBlockOf(e.state)
    expect(sel).toMatchObject({ tag: 'hero', mdAttrs: { headline: 'Hi' } })
    e.destroy()
  })
})

describe('useSelectedBlock render stability', () => {
  it('does NOT re-render on transactions that do not change the selected block', () => {
    const e = makeEditor()
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, 2)))
    let renders = 0
    const { result } = renderHook(() => { renders += 1; return useSelectedBlock(e) })
    expect(result.current?.tag).toBe('hero')
    const before = renders
    // Fire no-op transactions (the kind focus/IME/Radix churn produce). With no equality
    // guard each one re-renders -> with Radix children in the rail this becomes an infinite
    // "Maximum update depth exceeded" loop. The guard must keep these from re-rendering.
    // Separate commits: each no-op transaction is its own event. With the equality guard
    // React's eager bailout skips all three (0 renders); without it each yields a fresh
    // object and re-renders (3) — the churn that compounds into the infinite loop in-app.
    act(() => { e.view.dispatch(e.state.tr.setMeta('noop', 1)) })
    act(() => { e.view.dispatch(e.state.tr.setMeta('noop', 2)) })
    act(() => { e.view.dispatch(e.state.tr.setMeta('noop', 3)) })
    // Bounded: with the guard React's eager bailout keeps re-renders flat (≤1 settling).
    // Without it, each no-op re-renders (≥3 here, unbounded in-app). The point is no runaway.
    expect(renders - before).toBeLessThanOrEqual(1)
    expect(result.current?.tag).toBe('hero')
    e.destroy()
  })
})

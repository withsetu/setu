import { useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { STANDARD_BLOCKS, resolveControls } from '@setu/core'

// Single source of truth for the height range: the spacer contract's zod schema.
// resolveControls lifts .min/.max/.default — the same numbers the inspector slider
// uses — so canvas resize and inspector can never disagree on bounds.
const spacerContract = STANDARD_BLOCKS.find((b) => b.tag === 'spacer')
const heightCtl = spacerContract
  ? resolveControls(
      spacerContract.contract.props,
      spacerContract.contract.editor?.controls
    ).find((c) => c.name === 'height')
  : undefined
const MIN = heightCtl?.min ?? 8
const MAX = heightCtl?.max ?? 200
const DEFAULT = typeof heightCtl?.default === 'number' ? heightCtl.default : 48
/** Keyboard resize step (px per arrow press). */
const KEY_STEP = 8

const clamp = (n: number): number => Math.round(Math.min(MAX, Math.max(MIN, n)))

/** The committed height for a raw mdAttrs value: contract default when absent/invalid,
 *  clamped to the contract range otherwise. */
export function clampHeight(raw: unknown): number {
  const n = Number(raw)
  return clamp(
    raw === undefined || raw === null || !Number.isFinite(n) ? DEFAULT : n
  )
}

function SpacerBlockView({
  node,
  updateAttributes,
  selected
}: ReactNodeViewProps) {
  const md = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
  const committed = clampHeight(md['height'])
  // Local drag state: track live for smooth visuals, commit ONE document update on
  // release (single undo step, no per-pixel transactions).
  const [drag, setDrag] = useState<{
    startY: number
    startH: number
    h: number
  } | null>(null)
  const height = drag ? drag.h : committed

  const commit = (h: number) =>
    updateAttributes({ mdAttrs: { ...md, height: h } })

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // preventDefault stops Tiptap/browser drag-select, but also suppresses the
    // native focus-on-mousedown — focus explicitly so keyboard resize works next.
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.focus()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // synthetic pointer events (tests) have no active pointer to capture
    }
    setDrag({ startY: e.clientY, startH: committed, h: committed })
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const h = clamp(drag.startH + (e.clientY - drag.startY))
    if (h !== drag.h) setDrag({ ...drag, h })
  }
  const onPointerEnd = () => {
    if (!drag) return
    if (drag.h !== committed) commit(drag.h)
    setDrag(null)
  }
  // ARIA slider convention: Up/Right increase, Down/Left decrease; Home/End jump.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next =
      e.key === 'ArrowUp' || e.key === 'ArrowRight'
        ? clamp(committed + KEY_STEP)
        : e.key === 'ArrowDown' || e.key === 'ArrowLeft'
          ? clamp(committed - KEY_STEP)
          : e.key === 'Home'
            ? MIN
            : e.key === 'End'
              ? MAX
              : null
    if (next === null) return
    e.preventDefault()
    if (next !== committed) commit(next)
  }

  return (
    <NodeViewWrapper>
      <div className="setu-block" data-tag="spacer" contentEditable={false}>
        <div
          className={`blk-spacer-editor${selected ? ' is-selected' : ''}${drag ? ' is-dragging' : ''}`}
          style={{ height }}
          data-small={height < 28 ? '' : undefined}
        >
          <span className="blk-spacer-editor-label">{height} px</span>
          <div
            role="slider"
            tabIndex={0}
            aria-label="Spacer height"
            aria-orientation="vertical"
            aria-valuemin={MIN}
            aria-valuemax={MAX}
            aria-valuenow={height}
            aria-valuetext={`${height} pixels`}
            className="blk-spacer-editor-handle"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
    </NodeViewWrapper>
  )
}

/** The `{% spacer %}` block (#183) — atom (props-only, no body). Mirrors HeroBlock:
 *  mdAttrs JSON-only, kept out of the DOM, round-tripped by the core converter
 *  (to-tiptap maps spacer→spacerBlock, to-markdoc emits a self-closing {% spacer /%}).
 *  The node view adds a drag-to-resize handle; height is also editable via the
 *  inspector rail's slider. */
export const SpacerBlock = Node.create({
  name: 'spacerBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      mdAttrs: { default: {}, renderHTML: () => ({}), parseHTML: () => ({}) }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-setu-spacer-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-setu-spacer-block': '' })
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(SpacerBlockView)
  }
})

import { Node } from '@tiptap/core'
import type { NodeType, Node as PmNode, Schema } from '@tiptap/pm/model'
import { columnsRenderAttrs } from '@setu/blocks'
import { columnCountFor } from '@setu/core'

// The columns container (#181) — the first multi-slot nested block (Shape B, #121).
// Both nodes are PLAIN ProseMirror nodes (renderHTML + content hole, no React node
// view): the canvas visual is pure CSS driven by the same class/style derivation the
// site renderer uses (`columnsRenderAttrs` from @setu/blocks), so there is no
// selection-driven React state to loop (§4 #3) and editor/site can't drift.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      /** Change a columns block's layout, reconciling its column count: growing
       *  appends empty columns; shrinking moves the trailing columns' content into
       *  the last kept column (content is never dropped). */
      setColumnsLayout: (pos: number, layout: string) => ReturnType
    }
  }
}

const mdAttrsOf = (node: PmNode): Record<string, unknown> =>
  (node.attrs.mdAttrs ?? {}) as Record<string, unknown>

/** An empty column (one empty paragraph — `column` requires `block+`). */
const emptyColumn = (schema: Schema): PmNode => {
  const column = schema.nodes.column as NodeType
  const paragraph = schema.nodes.paragraph as NodeType
  return column.create(null, paragraph.create())
}

/** A block that carries no user content (an empty textblock, e.g. the seeded empty
 *  paragraph) — safe to leave behind when moving a column's content. */
const isEmptyBlock = (n: PmNode): boolean =>
  n.isTextblock && n.content.size === 0

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,4}',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      // JSON-only round-trip bag (kept out of the DOM), same as callout/setuBlock.
      mdAttrs: {
        default: {},
        renderHTML: () => ({}),
        parseHTML: () => ({})
      }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-columns]' }]
  },
  renderHTML({ HTMLAttributes, node }) {
    // Same class list + grid-template local as the site renderer — the canvas grid
    // IS the published grid (columns.css is imported by styles/editor.css).
    const { className, style } = columnsRenderAttrs(mdAttrsOf(node))
    return [
      'div',
      { ...HTMLAttributes, 'data-columns': '', class: className, style },
      0
    ]
  },
  addCommands() {
    return {
      setColumnsLayout:
        (pos, layout) =>
        ({ state, tr, dispatch }) => {
          const node = state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) return false
          const target = columnCountFor(layout)
          if (target < 2 || target > 4) return false
          if (!dispatch) return true

          tr.setNodeAttribute(pos, 'mdAttrs', {
            ...mdAttrsOf(node),
            layout
          })

          const current = node.childCount
          if (target > current) {
            // Grow: append empty columns just inside the container's closing token.
            const cols = Array.from({ length: target - current }, () =>
              emptyColumn(state.schema)
            )
            tr.insert(pos + node.nodeSize - 1, cols)
          } else if (target < current) {
            // Shrink: never drop content. Collect the non-empty blocks of every
            // trailing column, delete those columns, then append the collected
            // blocks to the last kept column.
            const moved: PmNode[] = []
            let trailStart = pos + 1
            node.forEach((child, offset, index) => {
              if (index === target) trailStart = pos + 1 + offset
              if (index >= target)
                child.forEach((block) => {
                  if (!isEmptyBlock(block)) moved.push(block)
                })
            })
            const trailEnd = pos + node.nodeSize - 1
            tr.delete(trailStart, trailEnd)
            if (moved.length) {
              // End of the last kept column's content = just before its closing
              // token, which now sits where the trailing columns began.
              tr.insert(trailStart - 1, moved)
            }
          }
          return true
        }
    }
  }
})

export const Column = Node.create({
  name: 'column',
  // Deliberately NO group: a column is only valid where a parent names it
  // (columns' `column{2,4}`), never as a free-standing top-level block.
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      // Unknown hand-authored attrs on {% column %} round-trip through here.
      mdAttrs: {
        default: {},
        renderHTML: () => ({}),
        parseHTML: () => ({})
      }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-column]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      { ...HTMLAttributes, 'data-column': '', class: 'blk-column' },
      0
    ]
  }
})

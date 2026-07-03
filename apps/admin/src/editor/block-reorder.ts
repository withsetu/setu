import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

/** Document position just before the top-level child at `index`. */
export function startOfChild(doc: PMNode, index: number): number {
  let pos = 0
  for (let i = 0; i < index; i += 1) pos += doc.child(i).nodeSize
  return pos
}

/** Move the top-level block at `fromIndex` to `toIndex`, mutating `tr`. Returns
 *  false (no mutation) for a no-op or out-of-range move. Pure w.r.t. the DOM —
 *  operates only on the document + transaction, so it is unit-testable and is
 *  shared by both the keyboard commands and the drag handle. */
export function moveBlock(
  doc: PMNode,
  tr: Transaction,
  fromIndex: number,
  toIndex: number
): boolean {
  if (fromIndex === toIndex) return false
  if (fromIndex < 0 || fromIndex >= doc.childCount) return false
  if (toIndex < 0 || toIndex >= doc.childCount) return false

  const node = doc.child(fromIndex)
  const from = startOfChild(doc, fromIndex)
  const to = from + node.nodeSize

  tr.delete(from, to)

  let insertPos: number
  if (toIndex > fromIndex) {
    // Moving down: land AFTER the block at toIndex. Positions >= `to` shifted left
    // by node.nodeSize once the source was deleted.
    insertPos =
      startOfChild(doc, toIndex) + doc.child(toIndex).nodeSize - node.nodeSize
  } else {
    // Moving up: target start is before the deleted range, so it is unaffected.
    insertPos = startOfChild(doc, toIndex)
  }
  tr.insert(insertPos, node)
  return true
}

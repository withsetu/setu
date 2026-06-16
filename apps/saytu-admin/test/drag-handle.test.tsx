import { describe, it, expect } from 'vitest'
import { dropTargetIndex } from '../src/editor/extensions/DragHandle'

describe('dropTargetIndex', () => {
  const tops = [0, 20, 40] // 3 blocks at y=0,20,40, each 20 tall

  it('returns the block index when dropping over its top half', () => {
    expect(dropTargetIndex(tops, 20, 25)).toBe(1)
  })

  it('returns the next index when dropping over the bottom half', () => {
    expect(dropTargetIndex(tops, 20, 35)).toBe(2)
  })

  it('clamps to the last index past the end', () => {
    expect(dropTargetIndex(tops, 20, 999)).toBe(2)
  })

  it('clamps to 0 before the start', () => {
    expect(dropTargetIndex(tops, 20, -50)).toBe(0)
  })
})

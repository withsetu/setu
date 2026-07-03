import { describe, it, expect } from 'vitest'
import {
  dropTargetIndex,
  dropToIndex
} from '../src/editor/extensions/DragHandle'

describe('dropTargetIndex', () => {
  const tops = [0, 20, 40] // 3 blocks at y=0,20,40, each 20 tall

  it('returns the block index when dropping over its top half', () => {
    expect(dropTargetIndex(tops, 20, 25)).toBe(1)
  })

  it('returns the next index when dropping over the bottom half', () => {
    expect(dropTargetIndex(tops, 20, 35)).toBe(2)
  })

  it('returns the append slot (length) past the end', () => {
    expect(dropTargetIndex(tops, 20, 999)).toBe(3)
  })

  it('clamps to 0 before the start', () => {
    expect(dropTargetIndex(tops, 20, -50)).toBe(0)
  })
})

describe('dropToIndex (drop coords + source -> moveBlock target index)', () => {
  const tops = [0, 20, 40]

  it('drag block 0 down into the bottom half of the last block -> append (index 2)', () => {
    expect(dropToIndex(tops, 20, 55, 0)).toBe(2) // [A,B,C] drag A to end -> [B,C,A]
  })

  it('drag block 0 down into the top half of the middle block -> no-op (index 0)', () => {
    // y=25 is block 1's top half -> slot 1 ("insert before B"), which is the gap
    // immediately after the source A -> A stays put. moveBlock(0,0) is a no-op.
    // (To land A after B -> [B,A,C] you must drop in B's bottom half, see slot 2.)
    expect(dropToIndex(tops, 20, 25, 0)).toBe(0)
  })

  it('drag block 0 down into the bottom half of the middle block -> index 1', () => {
    expect(dropToIndex(tops, 20, 35, 0)).toBe(1) // slot 2, source 0 -> [B,A,C]
  })

  it('drag the last block up into the top half of the first -> index 0', () => {
    expect(dropToIndex(tops, 20, 5, 2)).toBe(0) // C to front -> [C,A,B]
  })

  it('drag the last block up into the bottom half of the first -> index 1', () => {
    expect(dropToIndex(tops, 20, 15, 2)).toBe(1) // C after A -> [A,C,B]
  })

  it('dropping on either half of the source block is a no-op (target === source)', () => {
    expect(dropToIndex(tops, 20, 25, 1)).toBe(1) // top half of block 1, source 1
    expect(dropToIndex(tops, 20, 35, 1)).toBe(1) // bottom half of block 1, source 1
  })
})

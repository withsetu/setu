import { describe, it, expect } from 'vitest'
import type { BlockStyleAxis as CoreAxis } from '@setu/core'
import type { BlockStyleAxis as BlocksAxis } from '../src/tokens'

// Compile-time parity: each union must be assignable to the other. If the two unions
// drift (a member added/removed/renamed in only one package), one of these type
// aliases fails `tsc --noEmit` (packages/blocks typecheck includes test/). This is the
// drift guard for the deliberately-duplicated BlockStyleAxis (core must not dep blocks).
type CoreToBlocks = CoreAxis extends BlocksAxis ? true : never
type BlocksToCore = BlocksAxis extends CoreAxis ? true : never
const _coreToBlocks: CoreToBlocks = true
const _blocksToCore: BlocksToCore = true

describe('BlockStyleAxis parity (core <-> blocks)', () => {
  it('the two unions are mutually assignable (enforced at typecheck)', () => {
    expect(_coreToBlocks && _blocksToCore).toBe(true)
  })
})

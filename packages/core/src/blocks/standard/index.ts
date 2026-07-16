import type { StandardBlock } from './types'
import { buttonBlock } from './button'
import { heroBlock } from './hero'
import { videoBlock } from './video'

/** The canonical core block library — contracts that ship with Setu, token-themed. */
export const STANDARD_BLOCKS: StandardBlock[] = [
  buttonBlock,
  heroBlock,
  videoBlock
]
